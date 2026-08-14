// review-relink-campaign — ONE-TIME re-engagement (Teddy 2026-08-14): text the NEW one-tap
// rating link (rate.html) to every customer who completed a job since we dropped HCP but
// never responded — the ~200+ backlog. The old flow asked customers to REPLY 👍/👎 (only
// ~4% did), so almost none reached Google. This re-reaches them with the frictionless link.
//
// DIFFERENT from review-backfill (which respects the 60-day "already asked" dedup — that's
// exactly what blocks this backlog). This one:
//   • BYPASSES the 60-day dedup (the whole point is to re-ask the old-link crowd), BUT
//   • SKIPS anyone who actually responded (a 👍/👎 reply OR a star tap), and
//   • SKIPS anyone asked in the last 7 days (they already got the NEW link from the hourly
//     completion-watch / nightly sweep — don't double-text this week's fresh sends). This
//     7-day marker check also dedups the campaign itself by CUSTOMER across fires.
//
// PACED + CURSOR-BASED (SMS breaker halts at ~50/10min): scheduled fires send one capped
// batch each, walking a job cursor across the window without re-texting. Business-hours only
// when live. Kill: REVIEW_RELINK=off. Self-terminates once every customer is reached.
//
//   (scheduled) paced live batches — self-authorizes, business-hours-gated
//   GET ?secret=<admin>[&days=75]                    DRY-RUN preview (sends nothing)
//   GET ?secret=<admin>&days=75&max=40&confirm=SEND  manual live batch (9am–7pm CT)
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');
const guard = require('./_lib/sms-guard');
const satisfaction = require('./_lib/satisfaction');
const reviewI18n = require('./_lib/review-i18n');
const reviewAsk = require('./_lib/review-ask');
const { getSecret } = require('./_lib/secrets');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER = '+16154855795';
const RECENT_ASK_DAYS = 7;              // skip anyone asked within 7d (already has the new link)
const CURSOR_ACTION = 'review_relink_cursor';
exports.config = { timeout: 26 };

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function e164(p) { const d = String(p || '').replace(/\D/g, ''); if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; if (String(p || '').startsWith('+')) return String(p); return null; }
function mask(p) { const d = String(p || '').replace(/\D/g, ''); return d ? '•••-' + d.slice(-4) : ''; }
function ctHour() { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }).format(new Date())); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function askedWithin(custId, days) {
  try {
    const row = await crud.searchOne(crud.TABLES.event_log, { action: 'google_review_asked_customer_' + custId }, { id: 'desc' });
    if (!row) return false;
    const at = Number(row.created_at || meta(row).at_ms || 0);
    return at > Date.now() - days * 86400000;
  } catch (_) { return false; }
}
async function loadCursor() { try { const r = await crud.searchOne(crud.TABLES.event_log, { action: CURSOR_ACTION }, { id: 'desc' }); return new Set((meta(r).seen) || []); } catch (_) { return new Set(); } }
async function saveCursor(seen) { try { await crud.logEvent(CURSOR_ACTION, { seen: [...seen].slice(-1200), at_ms: Date.now() }); } catch (_) {} }
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); } }));
  return out;
}

// everyone who RESPONDED: thumb events carry job_id; star events carry both. Skip either.
async function respondedSets() {
  const jobs = new Set(), custs = new Set();
  try { for (const r of await crud.searchPage(crud.TABLES.event_log, { action: 'review_thumb' }, { id: 'desc' }, 500)) { const jid = Number(meta(r).job_id || 0); if (jid) jobs.add(jid); } } catch (_) {}
  try { for (const r of await crud.searchPage(crud.TABLES.event_log, { action: 'review_star' }, { id: 'desc' }, 500)) { const m = meta(r); if (Number(m.job_id || 0)) jobs.add(Number(m.job_id)); if (Number(m.cust_id || 0)) custs.add(Number(m.cust_id)); } } catch (_) {}
  return { jobs, custs };
}

// distinct completed jobs in the window (newest completion first), from the signals that flow.
async function completedInWindow(sinceMs) {
  const completed = new Map();
  const scan = (rows, isTransition) => {
    for (const r of rows || []) {
      const at = Number(r.created_at || 0); if (at < sinceMs) continue;
      const m = meta(r);
      if (isTransition && String(m.to || '').toLowerCase() !== 'completed') continue;
      const jid = Number(m.job_id || 0);
      if (jid && !completed.has(jid)) completed.set(jid, at);
    }
  };
  for (let p = 1; p <= 4; p++) scan(await crud.searchPageN(crud.TABLES.event_log, { action: 'office_set_job_status' }, { id: 'desc' }, 500, p), true);
  for (let p = 1; p <= 2; p++) scan(await crud.searchPageN(crud.TABLES.event_log, { action: 'job_completed' }, { id: 'desc' }, 500, p), false);
  for (let p = 1; p <= 2; p++) scan(await crud.searchPageN(crud.TABLES.event_log, { action: 'office_invoice_logged' }, { id: 'desc' }, 500, p), false);
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

  const days = Math.min(Math.max(parseInt(q.days || '75', 10) || 75, 1), 120);
  const max = Math.min(Math.max(parseInt(q.max || '40', 10) || 40, 1), 45);   // per fire, under the 50/10min breaker
  const live = scheduled || q.confirm === 'SEND';
  const since = Date.now() - days * 86400000;

  // LIVE sending is EXPLICIT-ON only (irreversible 200+ text campaign): set vault
  // REVIEW_RELINK=on to arm it. Dry-run always works so the count can be previewed first.
  const enabledLive = ['on', 'true', '1', 'yes'].includes(String(await getSecret('REVIEW_RELINK') || '').toLowerCase());
  if (live && !enabledLive) return j(200, { ok: false, live_disabled: true, note: 'Live send is OFF. Set vault REVIEW_RELINK=on to arm. Dry-run (no confirm=SEND / secret only) works without it.' });
  if (live) { const h = ctHour(); if (h < 9 || h >= 19) return j(200, { ok: false, error: 'outside send window — 9am–7pm CT (got ' + h + ':00 CT). Dry-run works anytime.' }); }

  let allJobs; try { allJobs = await completedInWindow(since); } catch (e) { return j(200, { ok: false, error: 'scan failed: ' + String((e && e.message) || e) }); }
  const resp = await respondedSets();

  const seen = live ? await loadCursor() : new Set();
  const candidates = allJobs.filter((jid) => !seen.has(jid) && !resp.jobs.has(jid));
  const examine = candidates.slice(0, live ? 80 : 150);

  const resolved = await pool(examine, 6, resolveJob);
  const eligible = [], skipped = [];
  for (const r of resolved) {
    if (!r || r.err) { skipped.push({ job_id: r && r.job_id, why: 'lookup failed' }); continue; }
    if (!r.custId || !r.phone) { skipped.push({ job_id: r.job_id, why: 'no customer/phone' }); continue; }
    if (!r.liveDone) { skipped.push({ job_id: r.job_id, why: 'not currently completed' }); continue; }
    if (resp.custs.has(r.custId)) { skipped.push({ job_id: r.job_id, why: 'customer already responded' }); continue; }
    if (await guard.isOptedOut(r.phone)) { skipped.push({ job_id: r.job_id, why: 'opted out' }); continue; }
    if (await askedWithin(r.custId, RECENT_ASK_DAYS)) { skipped.push({ job_id: r.job_id, why: 'asked < 7d (already has new link)' }); continue; }
    eligible.push(r);
  }

  if (!live) {
    return j(200, {
      ok: true, mode: 'dry-run', window_days: days, completed_in_window: allJobs.length, responders_excluded: resp.jobs.size,
      examined: examine.length, would_text: eligible.length, skipped: skipped.length,
      note: `DRY-RUN — sends nothing. ${allJobs.length} completed jobs in ${days}d. This re-engages non-responders with the NEW one-tap link. Scheduled fires send batches of ≤${max}. Manual: &confirm=SEND (9am–7pm CT). Enable the cron / run repeatedly to walk the whole backlog.`,
      would_text_list: eligible.slice(0, 40).map((r) => ({ job_id: r.job_id, first: r.first, phone: mask(r.phone), appliance: r.appl, city: r.city, lang: r.lang })),
    });
  }

  const toSend = eligible.slice(0, max);
  const sent = [];
  for (const r of toSend) {
    let ok = false, link = '';
    try {
      link = await reviewAsk.rateLink(r.job_id);
      const askLink = reviewI18n.pack(r.lang).askLink || reviewI18n.pack('en').askLink;
      ok = await sendSms(r.phone, askLink(r.first, (r.appl || '').toLowerCase(), link), 'customer', 'satisfaction_relink');
    } catch (_) { ok = false; }
    if (ok) {
      try { await satisfaction.arm(r.phone, { job_id: r.job_id, cust_id: r.custId, first: r.first, tech: r.tech, appliance: r.appl, city: r.city, lang: r.lang }); } catch (_) {}
      // fresh marker (via=relink) → the 7-day guard now dedups this customer across fires
      try { await crud.logEvent('google_review_asked_customer_' + r.custId, { job_id: r.job_id, via: 'relink', at_ms: Date.now() }); } catch (_) {}
      try { await crud.logEvent('review_ask_sent', { cust_id: r.custId, job_id: r.job_id, via: 'relink', lang: r.lang, at_ms: Date.now() }); } catch (_) {}
      sent.push({ job_id: r.job_id, first: r.first, phone: mask(r.phone) });
    } else skipped.push({ job_id: r.job_id, why: 'send blocked (opt-out/guard)' });
    await sleep(300);
  }

  // advance the job cursor over everything examined EXCEPT eligible jobs we didn't get to
  // this batch (they resurface next fire). Sent + skipped-permanently are marked.
  const sentIds = new Set(toSend.map((r) => r.job_id));
  const heldOver = new Set(eligible.filter((e) => !sentIds.has(e.job_id)).map((e) => e.job_id));
  for (const jid of examine) { if (!heldOver.has(jid)) seen.add(jid); }
  await saveCursor(seen);

  const remaining = allJobs.filter((jid) => !seen.has(jid) && !resp.jobs.has(jid)).length;
  if (sent.length) { try { await sendSms(OWNER, `[ant] 🔗 Review re-link batch: sent ${sent.length} the new one-tap link${remaining ? ` · ~${remaining} jobs to go` : ' · backlog cleared'}`, 'owner', 'review_relink'); } catch (_) {} }
  try { await crud.logEvent('review_relink_run', { window_days: days, sent: sent.length, examined: examine.length, remaining, scheduled, at_ms: Date.now() }); } catch (_) {}

  return j(200, { ok: true, mode: scheduled ? 'scheduled-live' : 'manual-live', window_days: days, texted: sent.length, skipped: skipped.length, approx_remaining: remaining, more_batches: remaining > 0, texted_list: sent });
};
