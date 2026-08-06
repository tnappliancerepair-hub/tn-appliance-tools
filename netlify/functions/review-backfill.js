// review-backfill — ONE-TIME catch-up: send "How'd we do?" to customers whose jobs
// completed in the last N days but were never asked (the review engine was starved for
// months). The nightly sweep is deliberately forward-only (26h), so it will NOT touch
// this backlog — hence a dedicated, tightly-gated tool.
//
// Reuses EVERY safety gate of the nightly sweep + the SAME 60-day dedup marker
// (google_review_asked_customer_<id>), so it can never double-text and can't collide
// with the nightly run. Manual + secret-gated (never scheduled).
//
//   GET ?secret=<admin>[&days=14][&max=40]           DRY-RUN — who WOULD be texted, sends nothing
//   GET ?secret=<admin>&days=14&max=40&confirm=SEND  actually text up to `max` (business hours only)
//
// SAFETY: dry-run by default · &confirm=SEND required to send · business-hours-only when live
// (9am–7pm CT) · per-run cap (default 40, hard 50, under the SMS breaker) · opt-out + phone +
// LIVE completed-status recheck + 60-day per-customer dedup all enforced · re-run for the next
// batch (dedup skips the already-sent).
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');
const guard = require('./_lib/sms-guard');
const satisfaction = require('./_lib/satisfaction');
const reviewI18n = require('./_lib/review-i18n');
const { getSecret } = require('./_lib/secrets');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const DEDUP_DAYS = 60;
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
// limited-concurrency map
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return j(401, { ok: false, error: 'unauthorized — ?secret=' });

  const days = Math.min(Math.max(parseInt(q.days || '14', 10) || 14, 1), 21);
  const max = Math.min(Math.max(parseInt(q.max || '40', 10) || 40, 1), 50);
  const live = q.confirm === 'SEND';
  const since = Date.now() - days * 86400000;

  // Business-hours-only when actually sending (never blast a backlog at 3am).
  if (live) { const h = ctHour(); if (h < 9 || h >= 19) return j(200, { ok: false, error: 'outside send window — run 9am–7pm CT (got ' + h + ':00 CT). Dry-run works anytime.' }); }

  // 1) completed jobs in the window — from the completion signals that actually flow.
  const completed = new Map(); // job_id -> completion at_ms
  const scanAdd = (rows, isTransition) => {
    for (const r of rows || []) {
      const at = Number(r.created_at || 0); if (at < since) continue;
      const m = meta(r);
      if (isTransition && String(m.to || '').toLowerCase() !== 'completed') continue;
      const jid = Number(m.job_id || 0);
      if (jid && !completed.has(jid)) completed.set(jid, at);
    }
  };
  try {
    // office_set_job_status → completed is the primary 2-week history (paginate for depth)
    for (let p = 1; p <= 3; p++) { scanAdd(await crud.searchPageN(crud.TABLES.event_log, { action: 'office_set_job_status' }, { id: 'desc' }, 500, p), true); }
    scanAdd(await crud.searchPage(crud.TABLES.event_log, { action: 'job_completed' }, { id: 'desc' }, 400), false);
    scanAdd(await crud.searchPage(crud.TABLES.event_log, { action: 'office_invoice_logged' }, { id: 'desc' }, 400), false);
  } catch (e) { return j(200, { ok: false, error: 'scan failed: ' + String((e && e.message) || e) }); }

  // newest completion first, examine up to `max` this batch (bounds runtime + send volume)
  const ordered = [...completed.entries()].sort((a, b) => b[1] - a[1]).map(([jid]) => jid);
  const batch = ordered.slice(0, max);

  // 2) resolve + gate each (read-only, pooled)
  const resolved = await pool(batch, 6, async (jid) => {
    try {
      const d = await fetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jid }), signal: AbortSignal.timeout(9000) }).then((r) => r.json());
      const cust = (d && d.customer) || {};
      const jss = String((d && d.job && d.job.scheduling_status) || '').toLowerCase();
      const jcs = String((d && d.job && d.job.current_status) || '').toLowerCase();
      const ap = (d && d.appliance) || {};
      return {
        job_id: jid, custId: Number(cust.id || 0), phone: e164(cust.phone),
        first: cust.first_name || 'there',
        appl: String((ap && ap.type) || (d && d.job && d.job.appliance_type) || '').trim(),
        tech: String(((d && d.tech) || {}).first_name || ((d && d.tech) || {}).name || '').trim().split(/\s+/)[0] || '',
        city: String(cust.city || (d && d.job && d.job.service_city) || '').trim(),
        lang: reviewI18n.langFromPref((d && d.job && d.job.customer_preference_text) || ''),
        liveDone: (jss === 'completed' || jcs === 'completed'),
      };
    } catch (_) { return { job_id: jid, err: 1 }; }
  });

  const eligible = [], skipped = [];
  for (const r of resolved) {
    if (!r || r.err) { skipped.push({ job_id: r && r.job_id, why: 'lookup failed' }); continue; }
    if (!r.custId || !r.phone) { skipped.push({ job_id: r.job_id, why: 'no customer/phone' }); continue; }
    if (!r.liveDone) { skipped.push({ job_id: r.job_id, why: 'not currently completed' }); continue; }
    if (await guard.isOptedOut(r.phone)) { skipped.push({ job_id: r.job_id, why: 'opted out' }); continue; }
    if (await askedRecently(r.custId)) { skipped.push({ job_id: r.job_id, why: 'asked < 60d' }); continue; }
    eligible.push(r);
  }

  // 3) DRY-RUN: report who's in this batch. LIVE: send with spacing.
  if (!live) {
    return j(200, {
      ok: true, mode: 'dry-run', window_days: days, batch_size: max,
      completed_in_window: completed.size, examined_this_batch: batch.length,
      would_text: eligible.length, skipped: skipped.length,
      note: `DRY-RUN — sends nothing. ${completed.size} jobs completed in ${days}d; this batch examined the newest ${batch.length}. Add &confirm=SEND (9am–7pm CT) to text the ${eligible.length} eligible; re-run for the next batch (dedup skips the already-sent).`,
      would_text_list: eligible.map((r) => ({ job_id: r.job_id, first: r.first, phone: mask(r.phone), appliance: r.appl, city: r.city, lang: r.lang })),
      skipped_list: skipped.slice(0, 15),
    });
  }

  const sent = [];
  for (const r of eligible) {
    const body = reviewI18n.pack(r.lang).ask(r.first, (r.appl || '').toLowerCase());
    let ok = false;
    try { await sendSms(r.phone, body, 'customer', 'satisfaction_backfill'); ok = true; } catch (_) {}
    if (ok) {
      try { await satisfaction.arm(r.phone, { job_id: r.job_id, cust_id: r.custId, first: r.first, tech: r.tech, appliance: r.appl, city: r.city, lang: r.lang }); } catch (_) {}
      try { await crud.logEvent('google_review_asked_customer_' + r.custId, { job_id: r.job_id, via: 'backfill', at_ms: Date.now() }); } catch (_) {}
      try { await crud.logEvent('review_ask_sent', { cust_id: r.custId, job_id: r.job_id, via: 'backfill', lang: r.lang, at_ms: Date.now() }); } catch (_) {}
      sent.push({ job_id: r.job_id, first: r.first, phone: mask(r.phone) });
    } else skipped.push({ job_id: r.job_id, why: 'send failed (opt-out/guard)' });
    await sleep(300); // gentle pacing — stay well under the SMS breaker (~50/10min)
  }

  try { await crud.logEvent('review_backfill_run', { window_days: days, sent: sent.length, examined: batch.length, at_ms: Date.now() }); } catch (_) {}
  const remaining = Math.max(0, completed.size - batch.length);
  return j(200, {
    ok: true, mode: 'LIVE', window_days: days, texted: sent.length, skipped: skipped.length,
    more_batches: remaining > 0, approx_remaining_in_window: remaining,
    note: remaining > 0 ? `Sent ${sent.length}. ~${remaining} more completed jobs remain in the window — run again (9am–7pm CT) for the next batch; the 60-day dedup skips everyone already texted.` : `Sent ${sent.length}. Window cleared.`,
    texted_list: sent,
  });
};
