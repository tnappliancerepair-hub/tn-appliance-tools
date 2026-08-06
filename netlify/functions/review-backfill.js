// review-backfill — ONE-TIME catch-up: a "thank you for the opportunity + how'd we do?"
// text to every eligible customer whose job completed in the last N days but was never
// asked (the review engine was starved for months). The nightly sweep is forward-only
// (26h) so it won't touch this backlog.
//
// PACED + CURSOR-BASED. The SMS breaker halts all outbound at ~50/10min, and there are
// ~100+ eligible people — so a single blast is impossible. This runs in scheduled fires
// (a few in the 6:15–7:00pm CT window), each sending one capped batch, walking a cursor
// so it covers the whole window WITHOUT re-texting anyone. Reuses every nightly-sweep
// gate + the SAME 60-day dedup marker, so it can never double-text or collide with the
// nightly run.
//
//   (scheduled) fires paced batches — self-authorizes, live, business-hours-gated
//   GET ?secret=<admin>[&days=14]                 DRY-RUN preview (sends nothing, no cursor move)
//   GET ?secret=<admin>&days=14&max=40&confirm=SEND   manual live batch (business hours only)
//
// Kill: REVIEW_BACKFILL=off. Fully self-terminates once the window is walked (candidates
// empty). Business-hours-only when live (9am–7pm CT). Cursor persists across fires/days.
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');
const guard = require('./_lib/sms-guard');
const satisfaction = require('./_lib/satisfaction');
const reviewI18n = require('./_lib/review-i18n');
const { getSecret } = require('./_lib/secrets');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER = '+16154855795';
const DEDUP_DAYS = 60;
const CURSOR_ACTION = 'review_backfill_cursor';
exports.config = { timeout: 26 };

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function e164(p) { const d = String(p || '').replace(/\D/g, ''); if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; if (String(p || '').startsWith('+')) return String(p); return null; }
function mask(p) { const d = String(p || '').replace(/\D/g, ''); return d ? '•••-' + d.slice(-4) : ''; }
function ctHour() { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }).format(new Date())); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function askedRecently(custId) {
  try {
    const row = await crud.searchOne(crud.TABLES.event_log, { action: 'google_review_asked_customer_' + custId }, { id: 'desc' });
    if (!row) return false;
    const at = Number(row.created_at || meta(row).at_ms || 0);
    return at > Date.now() - DEDUP_DAYS * 86400000;
  } catch (_) { return false; }
}
async function loadCursor() {
  try { const r = await crud.searchOne(crud.TABLES.event_log, { action: CURSOR_ACTION }, { id: 'desc' }); const m = meta(r); return new Set((m && m.seen) || []); } catch (_) { return new Set(); }
}
async function saveCursor(seen) {
  try { await crud.logEvent(CURSOR_ACTION, { seen: [...seen].slice(-800), at_ms: Date.now() }); } catch (_) {}
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

// Distinct completed jobs in the window, newest completion first, from the signals that flow.
async function completedInWindow(sinceMs) {
  const completed = new Map(); // job_id -> completion at_ms
  const scan = (rows, isTransition) => {
    for (const r of rows || []) {
      const at = Number(r.created_at || 0); if (at < sinceMs) continue;
      const m = meta(r);
      if (isTransition && String(m.to || '').toLowerCase() !== 'completed') continue;
      const jid = Number(m.job_id || 0);
      if (jid && !completed.has(jid)) completed.set(jid, at);
    }
  };
  for (let p = 1; p <= 3; p++) scan(await crud.searchPageN(crud.TABLES.event_log, { action: 'office_set_job_status' }, { id: 'desc' }, 500, p), true);
  scan(await crud.searchPage(crud.TABLES.event_log, { action: 'job_completed' }, { id: 'desc' }, 400), false);
  scan(await crud.searchPage(crud.TABLES.event_log, { action: 'office_invoice_logged' }, { id: 'desc' }, 400), false);
  return [...completed.entries()].sort((a, b) => b[1] - a[1]).map(([jid]) => jid);
}

async function resolveJob(jid) {
  try {
    const d = await fetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jid }), signal: AbortSignal.timeout(9000) }).then((r) => r.json());
    const cust = (d && d.customer) || {};
    const jss = String((d && d.job && d.job.scheduling_status) || '').toLowerCase();
    const jcs = String((d && d.job && d.job.current_status) || '').toLowerCase();
    const ap = (d && d.appliance) || {};
    return {
      job_id: jid, custId: Number(cust.id || 0), phone: e164(cust.phone), first: cust.first_name || 'there',
      appl: String((ap && ap.type) || (d && d.job && d.job.appliance_type) || '').trim(),
      tech: String(((d && d.tech) || {}).first_name || ((d && d.tech) || {}).name || '').trim().split(/\s+/)[0] || '',
      city: String(cust.city || (d && d.job && d.job.service_city) || '').trim(),
      lang: reviewI18n.langFromPref((d && d.job && d.job.customer_preference_text) || ''),
      liveDone: (jss === 'completed' || jcs === 'completed'),
    };
  } catch (_) { return { job_id: jid, err: 1 }; }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return j(401, { ok: false, error: 'unauthorized — ?secret=' });
  if (['off', 'false', '0'].includes(String(await getSecret('REVIEW_BACKFILL') || '').toLowerCase())) return j(200, { ok: true, disabled: true });

  const days = Math.min(Math.max(parseInt(q.days || '14', 10) || 14, 1), 21);
  const max = Math.min(Math.max(parseInt(q.max || '40', 10) || 40, 1), 45);   // per fire, under the 50/10min breaker
  const live = scheduled || q.confirm === 'SEND';
  const since = Date.now() - days * 86400000;

  if (live) { const h = ctHour(); if (h < 9 || h >= 19) return j(200, { ok: false, error: 'outside send window — 9am–7pm CT (got ' + h + ':00 CT). Dry-run works anytime.' }); }

  let allJobs;
  try { allJobs = await completedInWindow(since); } catch (e) { return j(200, { ok: false, error: 'scan failed: ' + String((e && e.message) || e) }); }

  // Cursor: skip jobs examined on prior fires so we advance through the whole window.
  const seen = live ? await loadCursor() : new Set();
  const candidates = allJobs.filter((jid) => !seen.has(jid));
  // examine enough to find a full batch; bounded for the 26s timeout
  const examine = candidates.slice(0, live ? 70 : 120);

  const resolved = await pool(examine, 6, resolveJob);
  const eligible = [], skipped = [];
  for (const r of resolved) {
    if (!r || r.err) { skipped.push({ job_id: r && r.job_id, why: 'lookup failed' }); continue; }
    if (!r.custId || !r.phone) { skipped.push({ job_id: r.job_id, why: 'no customer/phone' }); continue; }
    if (!r.liveDone) { skipped.push({ job_id: r.job_id, why: 'not currently completed' }); continue; }
    if (await guard.isOptedOut(r.phone)) { skipped.push({ job_id: r.job_id, why: 'opted out' }); continue; }
    if (await askedRecently(r.custId)) { skipped.push({ job_id: r.job_id, why: 'asked < 60d' }); continue; }
    eligible.push(r);
  }

  // DRY-RUN preview (no send, no cursor move)
  if (!live) {
    return j(200, {
      ok: true, mode: 'dry-run', window_days: days, completed_in_window: allJobs.length,
      examined: examine.length, would_text: eligible.length, skipped: skipped.length,
      note: `DRY-RUN — sends nothing. ${allJobs.length} completed in ${days}d. Scheduled fires (6:18/6:36/6:54pm CT) send paced batches of ≤${max} until all eligible are asked. Manual send: &confirm=SEND (9am–7pm CT).`,
      would_text_list: eligible.slice(0, 40).map((r) => ({ job_id: r.job_id, first: r.first, phone: mask(r.phone), appliance: r.appl, city: r.city, lang: r.lang })),
    });
  }

  // LIVE: send up to `max`, pace under the breaker, advance the cursor over everything examined.
  const toSend = eligible.slice(0, max);
  const sent = [];
  for (const r of toSend) {
    const body = reviewI18n.pack(r.lang).ask(r.first, (r.appl || '').toLowerCase());
    let ok = false;
    try { await sendSms(r.phone, body, 'customer', 'satisfaction_backfill'); ok = true; } catch (_) {}
    if (ok) {
      try { await satisfaction.arm(r.phone, { job_id: r.job_id, cust_id: r.custId, first: r.first, tech: r.tech, appliance: r.appl, city: r.city, lang: r.lang }); } catch (_) {}
      try { await crud.logEvent('google_review_asked_customer_' + r.custId, { job_id: r.job_id, via: 'backfill', at_ms: Date.now() }); } catch (_) {}
      try { await crud.logEvent('review_ask_sent', { cust_id: r.custId, job_id: r.job_id, via: 'backfill', lang: r.lang, at_ms: Date.now() }); } catch (_) {}
      sent.push({ job_id: r.job_id, first: r.first, phone: mask(r.phone) });
    } else skipped.push({ job_id: r.job_id, why: 'send failed (opt-out/guard)' });
    await sleep(300);
  }

  // Advance cursor over EVERYTHING examined (asked, skipped-terminal, or held) so the next
  // fire moves to older jobs. Eligible-but-unsent-this-batch (over `max`) are NOT marked, so
  // they surface next fire.
  const sentIds = new Set(toSend.map((r) => r.job_id));
  const examinedResolved = new Set(resolved.filter((r) => r && !r.err).map((r) => r.job_id));
  for (const jid of examine) { if (examinedResolved.has(jid) && !(eligible.some((e) => e.job_id === jid) && !sentIds.has(jid))) seen.add(jid); }
  toSend.forEach((r) => seen.add(r.job_id));
  await saveCursor(seen);

  const remaining = allJobs.filter((jid) => !seen.has(jid)).length;
  if (sent.length) { try { await sendSms(OWNER, `[ant] 🙏 Thank-you/review batch: sent ${sent.length}${remaining ? ` · ~${remaining} to go` : ' · window cleared'}`, 'owner', 'review_backfill'); } catch (_) {} }
  try { await crud.logEvent('review_backfill_run', { window_days: days, sent: sent.length, examined: examine.length, remaining, scheduled, at_ms: Date.now() }); } catch (_) {}

  return j(200, { ok: true, mode: scheduled ? 'scheduled-live' : 'manual-live', window_days: days, texted: sent.length, skipped: skipped.length, approx_remaining: remaining, more_batches: remaining > 0, texted_list: sent });
};
