// review-relink-campaign — ONE-TIME re-engagement (Teddy 2026-08-14): text the NEW one-tap
// rating link (rate.html) to every customer who completed a job but never responded — the
// backlog that piled up since we dropped HCP. The old flow asked customers to REPLY 👍/👎
// (only ~4% did), so almost none reached Google. This re-reaches them with the frictionless
// link a customer just taps.
//
// SOURCE: the office board feed (get_office_kanban) — its completed lane already carries
// customer name + phone + appliance, so no per-job lookups (fast, one call). One text per
// CUSTOMER (their completed job).
//
// EXCLUDES (so nobody is spammed / re-nagged):
//   • responders — anyone who left a 👍/👎 reply or tapped a star (never re-ask them)
//   • already re-linked — a customer who already got THIS campaign's link (one-time)
//   • asked in the last 7 days — they already have the new link from the hourly
//     completion-watch / nightly sweep; don't double-text this week's fresh sends
// All three are derived from batched event_log reads (review_ask_sent / _thumb / _star) —
// no per-customer lookups — so the whole run is fast and breaker-safe.
//
// PACED: each fire texts up to `max` (under the 50/10min SMS breaker); the "already re-linked"
// set advances the campaign automatically across fires (no cursor needed). Business-hours only
// when live. LIVE send is EXPLICIT-ON (vault REVIEW_RELINK=on) so the count is dry-run-previewed
// first. Kill: REVIEW_RELINK=off. Self-terminates once every non-responder is reached.
//
//   GET ?secret=<admin>                    DRY-RUN preview (sends nothing, no flag needed)
//   GET ?secret=<admin>&max=40&confirm=SEND  manual live batch (needs REVIEW_RELINK=on, 9am–7pm CT)
//   (scheduled, if a cron is added)         paced live batches — self-authorizes
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');
const satisfaction = require('./_lib/satisfaction');
const reviewI18n = require('./_lib/review-i18n');
const reviewAsk = require('./_lib/review-ask');
const { getSecret } = require('./_lib/secrets');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER = '+16154855795';
const RECENT_ASK_DAYS = 7;
const TECHS = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 6: 'John' };
exports.config = { timeout: 26 };

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function e164(p) { const d = String(p || '').replace(/\D/g, ''); if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; if (String(p || '').startsWith('+')) return String(p); return null; }
function mask(p) { const d = String(p || '').replace(/\D/g, ''); return d ? '•••-' + d.slice(-4) : ''; }
function ctHour() { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }).format(new Date())); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// completed jobs from the board feed, one per customer (newest), with phone.
async function completedFromBoard() {
  let feed;
  try { feed = await fetch(`${XANO}/get_office_kanban`, { signal: AbortSignal.timeout(12000) }).then((r) => r.json()); } catch (_) { return []; }
  let jobs = Array.isArray(feed) ? feed : null;
  if (!jobs && feed && typeof feed === 'object') { for (const v of Object.values(feed)) { if (Array.isArray(v) && v[0] && typeof v[0] === 'object') { jobs = v; break; } } }
  jobs = jobs || [];
  const byCust = new Map();
  for (const jb of jobs) {
    const st = String(jb.scheduling_status || '').toLowerCase(); const cs = String(jb.current_status || '').toLowerCase();
    if (st !== 'completed' && cs !== 'completed') continue;         // only currently-completed
    const custId = Number(jb.customer_id || 0); const phone = e164(jb.customer_phone);
    if (!custId || !phone) continue;
    const at = Number(jb.job_completed_at || jb.scheduled_start || jb.created_at || 0);
    const prev = byCust.get(custId);
    if (prev && Number(prev._at || 0) >= at) continue;              // keep newest job per customer
    byCust.set(custId, {
      job_id: Number(jb.id || 0), custId, phone, first: String(jb.customer_first || 'there').trim() || 'there',
      appl: String(jb.appliance || '').trim(), city: String(jb.service_city || '').trim(),
      tech: TECHS[Number(jb.technician_id || 0)] || '', lang: reviewI18n.langFromPref(jb.customer_preference_text || ''), _at: at,
    });
  }
  return [...byCust.values()];
}

// batched exclusion sets — one read per action, no per-customer lookups.
async function exclusionSets() {
  const respondedJobs = new Set(), respondedCusts = new Set(), relinkedCusts = new Set(), recentCusts = new Set();
  const cutoff = Date.now() - RECENT_ASK_DAYS * 86400000;
  try { for (const r of await crud.searchPage(crud.TABLES.event_log, { action: 'review_thumb' }, { id: 'desc' }, 500)) { const jid = Number(meta(r).job_id || 0); if (jid) respondedJobs.add(jid); } } catch (_) {}
  try { for (const r of await crud.searchPage(crud.TABLES.event_log, { action: 'review_star' }, { id: 'desc' }, 500)) { const m = meta(r); if (Number(m.job_id || 0)) respondedJobs.add(Number(m.job_id)); if (Number(m.cust_id || 0)) respondedCusts.add(Number(m.cust_id)); } } catch (_) {}
  try {
    for (let p = 1; p <= 3; p++) {
      const rows = await crud.searchPageN(crud.TABLES.event_log, { action: 'review_ask_sent' }, { id: 'desc' }, 500, p);
      for (const r of rows || []) {
        const m = meta(r); const cid = Number(m.cust_id || 0); if (!cid) continue;
        if (String(m.via || '') === 'relink') relinkedCusts.add(cid);               // one-time: don't re-relink
        if (Number(r.created_at || m.at_ms || 0) > cutoff) recentCusts.add(cid);     // don't double-text this week
      }
      if (!rows || rows.length < 500) break;
    }
  } catch (_) {}
  return { respondedJobs, respondedCusts, relinkedCusts, recentCusts };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return j(401, { ok: false, error: 'unauthorized — ?secret=' });

  const max = Math.min(Math.max(parseInt(q.max || '40', 10) || 40, 1), 45);
  const live = scheduled || q.confirm === 'SEND';
  const enabledLive = ['on', 'true', '1', 'yes'].includes(String(await getSecret('REVIEW_RELINK') || '').toLowerCase());
  if (live && !enabledLive) return j(200, { ok: false, live_disabled: true, note: 'Live send is OFF. Set vault REVIEW_RELINK=on to arm. Dry-run (secret only, no confirm=SEND) works without it.' });
  if (live) { const h = ctHour(); if (h < 9 || h >= 19) return j(200, { ok: false, error: 'outside send window — 9am–7pm CT (got ' + h + ':00 CT). Dry-run works anytime.' }); }

  const [completed, ex] = await Promise.all([completedFromBoard(), exclusionSets()]);

  const eligible = [], skipped = { responded: 0, relinked: 0, asked_recent: 0 };
  for (const r of completed) {
    if (ex.respondedCusts.has(r.custId) || ex.respondedJobs.has(r.job_id)) { skipped.responded++; continue; }
    if (ex.relinkedCusts.has(r.custId)) { skipped.relinked++; continue; }
    if (ex.recentCusts.has(r.custId)) { skipped.asked_recent++; continue; }
    eligible.push(r);
  }

  if (!live) {
    return j(200, {
      ok: true, mode: 'dry-run', completed_customers_on_board: completed.length,
      excluded: skipped, eligible_total: eligible.length,
      batch_size: max, batches_to_clear: Math.ceil(eligible.length / max),
      note: `DRY-RUN — sends nothing. ${eligible.length} customers would get the NEW one-tap review link (each once). Arm with vault REVIEW_RELINK=on, then &confirm=SEND (9am–7pm CT) or a cron sends batches of ≤${max}.`,
      sample: eligible.slice(0, 15).map((r) => ({ job_id: r.job_id, first: r.first, phone: mask(r.phone), appliance: r.appl, city: r.city, lang: r.lang })),
    });
  }

  const toSend = eligible.slice(0, max);
  const sent = [];
  for (const r of toSend) {
    let ok = false;
    try {
      const link = await reviewAsk.rateLink(r.job_id);
      const askLink = reviewI18n.pack(r.lang).askLink || reviewI18n.pack('en').askLink;
      ok = await sendSms(r.phone, askLink(r.first, (r.appl || '').toLowerCase(), link), 'customer', 'satisfaction_relink');
    } catch (_) { ok = false; }
    if (ok) {
      try { await satisfaction.arm(r.phone, { job_id: r.job_id, cust_id: r.custId, first: r.first, tech: r.tech, appliance: r.appl, city: r.city, lang: r.lang }); } catch (_) {}
      try { await crud.logEvent('google_review_asked_customer_' + r.custId, { job_id: r.job_id, via: 'relink', at_ms: Date.now() }); } catch (_) {}
      try { await crud.logEvent('review_ask_sent', { cust_id: r.custId, job_id: r.job_id, via: 'relink', lang: r.lang, at_ms: Date.now() }); } catch (_) {}
      sent.push({ job_id: r.job_id, first: r.first, phone: mask(r.phone) });
    } else skipped.send_blocked = (skipped.send_blocked || 0) + 1;
    await sleep(300);
  }

  const remaining = Math.max(0, eligible.length - sent.length);
  if (sent.length) { try { await sendSms(OWNER, `[ant] 🔗 Review re-link batch: sent ${sent.length} the new one-tap link${remaining ? ` · ~${remaining} to go` : ' · backlog cleared'}`, 'owner', 'review_relink'); } catch (_) {} }
  try { await crud.logEvent('review_relink_run', { sent: sent.length, eligible: eligible.length, remaining, scheduled, at_ms: Date.now() }); } catch (_) {}

  return j(200, { ok: true, mode: scheduled ? 'scheduled-live' : 'manual-live', texted: sent.length, remaining, more_batches: remaining > 0, excluded: skipped, texted_list: sent });
};
