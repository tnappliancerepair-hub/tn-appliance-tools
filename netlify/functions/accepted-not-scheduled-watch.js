// accepted-not-scheduled-watch — the ACTIVE tripwire for the Calvin Gibson failure:
// a warranty job that gets accepted (a real appointment date lands) but never gets
// a tech, so it's invisible on the board AND on every tech's day, and nobody knows
// it exists. (Teddy 2026-07-13: "we accepted this job, it didn't get added to
// anybody's schedule, nobody even knew it existed. We've gotta protect ourselves.")
//
// It scans the BLIND-SPOT statuses the board doesn't even render (needs_more_info,
// held) plus 'scheduled', for no-tech jobs with a near-term date (or a fresh
// accept), and TEXTS Teddy + Danielle — re-alerting until the job gets a tech.
// A passive board banner wasn't enough; this pings a phone.
//
//   GET               -> view the current accepted-but-unassigned list (no SMS)
//   GET (scheduled)    -> same + SMS Teddy/Danielle if anything's unassigned
//   GET ?alert=1       -> force the SMS path manually
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
// Scheduling is delegated to Danielle + Sofia (Teddy 2026-08-14) — these accepted/no-tech
// alerts go to THEM, not the owner. (OWNER kept only for reference; no longer texted here.)
const DANIELLE = process.env.DANIELLE_PHONE_NUMBER || '+16154850713';
const SOFIA = process.env.SOFIA_PHONE_NUMBER || '+16292594602';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const J = (c, b) => ({ statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) });
const first = (r, keys) => { for (const k of keys) { const v = r && r[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim(); } return ''; };
const meta = (r) => { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; };
async function jpost(url, body) { try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(9000) }); return r.json().catch(() => ({})); } catch (_) { return {}; } }

// Statuses that can hide an accepted job. 'needs_more_info' + 'held' are NOT even
// loaded by the office board, so a job parked there with no tech is fully invisible.
const SCAN_STATUSES = ['scheduled', 'needs_more_info', 'held'];
const TERMINAL = /cancel|complete/i;
const FRESH_MS = 3 * 86400000;                 // a brand-new accept, no date yet
const NEAR_FUTURE_MS = 21 * 86400000;          // a real upcoming appointment
const NEAR_PAST_MS = 5 * 86400000;             // a date that already passed, still no tech = worse

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const scheduled = (() => { try { return !!JSON.parse((event && event.body) || '{}').next_run; } catch (_) { return false; } })();
  const alertMode = q.alert === '1' || scheduled;
  const now = Date.now();

  let rows = [];
  try {
    for (const st of SCAN_STATUSES) {
      for (let p = 1; p <= 6; p++) {
        const page = await crud.searchPageN(crud.TABLES.jobs, { scheduling_status: st }, { id: 'desc' }, 100, p);
        if (!page.length) break;
        rows = rows.concat(page);
        if (page.length < 100) break;
      }
    }
  } catch (e) { return J(500, { ok: false, error: 'scan_failed', detail: String((e && e.message) || e) }); }

  const out = [];
  for (const r of rows) {
    if (Number(r.technician_id || 0) > 0) continue;                       // has a tech → it's on someone's day
    const ss = String(r.scheduling_status || ''); const cs = String(r.current_status || '');
    if (TERMINAL.test(ss) || TERMINAL.test(cs)) continue;
    const date = Number(r.scheduled_start || 0) || 0;
    const nearTerm = date && date > (now - NEAR_PAST_MS) && date < (now + NEAR_FUTURE_MS);   // a real, current appointment
    // THE FIRE, precisely: a committed appointment date with NO tech. That is the
    // Calvin Gibson signature (accepted → date set → never assigned). We do NOT
    // alarm on fresh dateless SquareTrade shells — those are normal intake being
    // triaged, and alerting on every incoming dispatch would spam the phone.
    if (!nearTerm) continue;
    const vendor = first(r, ['warranty_company']);
    out.push({
      job_id: r.id,
      customer: `${first(r, ['customer_first'])} ${first(r, ['customer_last'])}`.trim() || '(no name)',
      appliance: first(r, ['appliance_type']) || '?',
      where: [first(r, ['service_city']), first(r, ['service_state', 'service_zip'])].filter(Boolean).join(' '),
      vendor: vendor || '?',
      dispatch: first(r, ['dispatch_source_id', 'claim_number']),
      status: ss,
      scheduled_start: date || null,
      no_address: !first(r, ['address', 'service_zip']),
      urgent: !!nearTerm,
    });
  }
  out.sort((a, b) => (b.urgent - a.urgent) || ((b.scheduled_start || 0) - (a.scheduled_start || 0)));

  let alerted = false;
  if (alertMode && out.length) {
    // Dedup: only re-fire when the set of unassigned job_ids changes, or >6h since
    // the last alert for the same set — so it nags until cleared without spamming.
    const sig = out.map((x) => x.job_id).sort((a, b) => a - b).join(',');
    let last = null;
    try { const lr = await crud.searchPage(crud.TABLES.event_log, { action: 'accepted_unassigned_alert' }, { id: 'desc' }, 1); last = lr && lr[0]; } catch (_) {}
    const lm = meta(last); const lastSig = lm.sig || ''; const lastAt = Number(lm.at_ms) || (last ? new Date(last.created_at).getTime() : 0);
    const stale = !lastAt || (now - lastAt) > 6 * 3600000;
    if (sig !== lastSig || stale) {
      const lines = out.slice(0, 8).map((x) => `• ${x.customer} — ${x.appliance}${x.where ? ' (' + x.where + ')' : ''} [${x.vendor}]${x.no_address ? ' ⚠no addr' : ''}`);
      const msg = `🚨 ${out.length} ACCEPTED job(s) with NO TECH — not on anyone's schedule, invisible on the board:\n${lines.join('\n')}\nAssign a tech now or it gets missed (like Calvin Gibson). Board → red "Accepted but nowhere" card.`;
      await jpost(`${XANO}/send_sms`, { to: DANIELLE, message: msg, context_tag: 'accepted_unassigned', force_send: true });
      await jpost(`${XANO}/send_sms`, { to: SOFIA, message: msg, context_tag: 'accepted_unassigned', force_send: true });
      await crud.logEvent('accepted_unassigned_alert', { sig, count: out.length, job_ids: out.map((x) => x.job_id), at_ms: now });
      alerted = true;
    }
  }

  return J(200, { ok: true, count: out.length, urgent: out.filter((x) => x.urgent).length, alerted, scanned: rows.length, jobs: out });
};
