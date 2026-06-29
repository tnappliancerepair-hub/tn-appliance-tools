// parts-arrival-watch — the no-Danielle "the part's here, put them back on a
// tech's day" loop. The gap it closes (the #19832 case): a job parked in
// awaiting_parts never auto-returns to a tech's schedule when the part lands —
// a human has to notice. This watches for arrivals from EVERY source and (live)
// re-opens the job so the auto-place engine schedules it hands-off.
//
// Arrival signals, per awaiting-parts job (no fragile global parsing — each is
// matched to the specific job):
//   • delivery_email — a Gmail delivery/shipping email mentioning THIS customer's
//     zip or last name (covers AMAZON, which has no API but emails a receipt;
//     also Marcone/FedEx "delivered" + warranty-vendor ship emails). HARD signal.
//   • eta_passed     — the part's ETA date has come/gone. SOFT signal (the part
//     could be late) → digest only, never auto-acts.
//
// Modes:
//   SHADOW (default)     — detect + text Teddy a "parts in, ready to schedule"
//                          digest. Immediate value with no auto-actions.
//   LIVE (PARTS_ARRIVAL_LIVE=true) — additionally calls mark_parts_arrived on
//                          EMAIL-confirmed jobs (moves them to Needs Scheduled),
//                          where the auto-place sweep finishes the job. ETA-only
//                          jobs still just go in the digest for a human glance.
//
//   GET ?secret=<admin>[&jobs=20][&noemail=1][&dry=1]
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
let searchAll = null; try { ({ searchAll } = require('./_lib/gmail-accounts')); } catch (_) {}

const INTAKE = (process.env.XANO_INTAKE_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA').replace(/\/+$/, '');
const OWNER = '+16154855795';
const JOBS_TABLE = 7, CUSTOMER_TABLE = 6, EVENT_TABLE = 3;

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function startOfTodayCT() { const ymd = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); return Date.parse(ymd + 'T00:00:00-05:00'); }
async function post(path, body) { try { const r = await fetch(`${INTAKE}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) }); return r.ok ? r.json().catch(() => ({})) : { ok: false, status: r.status }; } catch (e) { return { ok: false, error: String(e.message || e) }; } }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const scheduled = !!event.headers && (event.headers['x-nf-event'] === 'schedule' || event.headers['X-Nf-Event'] === 'schedule');
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const cap = Math.max(1, Math.min(40, parseInt(q.jobs, 10) || 20));
  const doEmail = q.noemail !== '1' && !!searchAll;
  const dry = q.dry === '1';
  // live flag is VAULT-readable (admin-secrets.html) so it flips with no Netlify
  // env edit (and no 4KB-cap pressure). env still works as an override.
  const live = String((await getSecret('PARTS_ARRIVAL_LIVE')) || process.env.PARTS_ARRIVAL_LIVE || '').toLowerCase() === 'true';
  const todayMs = startOfTodayCT();

  const out = { ok: true, mode: live ? 'LIVE' : 'shadow', dry, email_scan: doEmail, awaiting_parts: 0, arrived: 0, by_signal: { delivery_email: 0, eta_passed: 0 }, acted: 0, items: [], errors: [] };

  // awaiting-parts jobs
  let jobs = [];
  try { jobs = (await crud.searchPage(JOBS_TABLE, { scheduling_status: 'awaiting_parts' }, { id: 'desc' }, cap)) || []; }
  catch (e) { return json(200, { ok: false, error: 'jobs_list: ' + String(e.message || e) }); }
  out.awaiting_parts = jobs.length;

  // who have we already flagged in the last ~7d (so we don't re-text / re-act)
  const notified = new Set();
  try {
    const rows = await crud.searchPage(EVENT_TABLE, { action: 'parts_arrival_notified' }, { id: 'desc' }, 200);
    const since = Date.now() - 7 * 86400000;
    for (const r of rows || []) { if (Number(r.created_at || 0) < since) continue; let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } for (const id of (m && m.job_ids) || []) notified.add(Number(id)); }
  } catch (_) {}

  const arrived = [];
  for (const job of jobs) {
    const jobId = Number(job.id);
    if (!jobId) continue;

    // customer (zip + last name) for the per-job email match
    let cust = {};
    try { const cr = await crud.searchPage(CUSTOMER_TABLE, { id: job.customer_id }, {}, 1); cust = (cr && cr[0]) || {}; } catch (_) {}
    const zip = String(cust.zip || '').replace(/\D/g, '').slice(0, 5);
    const last = String(cust.last_name || '').trim();
    const name = [cust.first_name, cust.last_name].filter(Boolean).join(' ') || '(no name)';
    const city = String(cust.city || '').trim();

    // SOFT: ETA passed
    const etaMs = job.part_eta ? Date.parse(String(job.part_eta)) : NaN;
    const etaPassed = Number.isFinite(etaMs) && etaMs <= todayMs;

    // HARD: a delivery email that names this customer (zip or last name)
    let emailHit = null;
    if (doEmail && (zip || last)) {
      const who = [zip ? `"${zip}"` : '', last ? `"${last}"` : ''].filter(Boolean).join(' OR ');
      const Q = `(delivered OR "out for delivery" OR "has shipped" OR "was delivered") (${who}) newer_than:12d`;
      try { const res = await searchAll(Q, { max: 2 }); if (res && res.matches && res.matches.length) { const m = res.matches[0]; emailHit = { from: (m.from || '').slice(0, 60), subject: (m.subject || '').slice(0, 80), account: m.account }; } }
      catch (e) { out.errors.push(`email ${jobId}: ${String(e.message || e).slice(0, 60)}`); }
    }

    const signal = emailHit ? 'delivery_email' : (etaPassed ? 'eta_passed' : null);
    if (!signal) continue;
    out.arrived++; out.by_signal[signal]++;
    const rec = { job_id: jobId, name, city, zip, signal, eta: job.part_eta || null, email: emailHit, already_flagged: notified.has(jobId) };
    arrived.push(rec);
    if (out.items.length < 25) out.items.push(rec);
  }

  // newly-arrived (not already flagged this week)
  const fresh = arrived.filter((a) => !a.already_flagged);
  const freshEmail = fresh.filter((a) => a.signal === 'delivery_email');
  const freshEta = fresh.filter((a) => a.signal === 'eta_passed');

  // LIVE: auto-reopen EMAIL-confirmed jobs → Needs Scheduled (auto-place finishes it).
  // ETA-only stays a human-glance item (a part can be late; never auto-act on soft).
  const actedIds = [];
  if (live && !dry) {
    for (const a of freshEmail) {
      const r = await post('mark_parts_arrived', { job_id: a.job_id, source: 'ant_parts_arrival', notes: `delivery email (${a.email && a.email.from})` });
      if (r && (r.success || r.ok || r.job_id)) {
        actedIds.push(a.job_id); out.acted++;
        // trigger the ONE scheduling engine immediately (don't wait up to 3h for
        // the sweep). job_intake_complete now sees parts cleared → auto-places per
        // the customer's availability + the tech's profile + capacity. Whether it
        // BOOKS or just shadows is governed by the engine's own TECH_OFFER_LIVE.
        await post('emit_colony_signal', { signal_type: 'JOB_INTAKE_COMPLETE', signal_strength: 45, source_colony: 'parts_arrival', target_colonies: '', payload: JSON.stringify({ job_id: a.job_id, source: 'parts_arrival' }) });
      } else out.errors.push(`mark ${a.job_id}: ${JSON.stringify(r).slice(0, 80)}`);
    }
  }

  // Digest to Teddy (the immediate no-Danielle value — even in shadow).
  if (fresh.length && !dry) {
    const lines = [];
    if (freshEmail.length) {
      lines.push(live ? `✅ Parts DELIVERED → sent to auto-scheduler:` : `🔧 Parts DELIVERED (per email) — ready to schedule:`);
      for (const a of freshEmail.slice(0, 8)) lines.push(`• ${a.name}${a.city ? ', ' + a.city : ''} (job #${a.job_id})`);
    }
    if (freshEta.length) {
      lines.push(`⏳ Past parts-ETA (confirm it's in, then schedule):`);
      for (const a of freshEta.slice(0, 8)) lines.push(`• ${a.name}${a.city ? ', ' + a.city : ''} — ETA ${a.eta} (job #${a.job_id})`);
    }
    const body = `[ant parts]\n${lines.join('\n')}`;
    try { await post('send_sms', { to: OWNER, message: body.slice(0, 600), context_tag: 'parts_arrival' }); } catch (_) {}
    // dedup record (shadow flags by email+eta; live records the acted ones too)
    try { await crud.logEvent('parts_arrival_notified', { job_ids: fresh.map((a) => a.job_id), acted: actedIds, mode: out.mode, at_ms: Date.now() }); } catch (_) {}
  }
  try { await crud.logEvent('parts_arrival_sweep', { awaiting: out.awaiting_parts, arrived: out.arrived, by_signal: out.by_signal, fresh: fresh.length, acted: out.acted, mode: out.mode, at_ms: Date.now() }); } catch (_) {}

  out.fresh = fresh.length; out.acted_job_ids = actedIds;
  out.summary = `${out.awaiting_parts} awaiting · ${out.arrived} look arrived (${out.by_signal.delivery_email} email, ${out.by_signal.eta_passed} eta) · ${fresh.length} new · ${live ? out.acted + ' auto-scheduled' : 'shadow (no auto-act)'}`;
  return json(200, out);
};
