// andre-late-forward — Teddy 2026-07-07: after we texted Andre's 8 today-customers a
// "running behind" notice, forward any REPLY from those customers straight to Teddy's
// cell so he can act on reschedule requests. Self-expiring: only forwards replies in
// an 18h window after the notice, so it quietly no-ops after today (remove the cron
// whenever). Deduped per inbound row.
'use strict';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER = '+16154855795';               // Teddy's cell — owner forward only
const NOTICE_SINCE_MS = 1783442442257;      // when the running-behind notice went out
const WINDOW_MS = 18 * 3600 * 1000;         // forward replies for ~18h, then stop
const CORS = { 'content-type': 'application/json' };

function last10(v){ const d=String(v||'').replace(/\D/g,''); return d.length>=10?d.slice(-10):''; }
function asObj(m){ if(typeof m==='string'){ try{return JSON.parse(m);}catch(_){return {};} } return m||{}; }
async function jget(url,ms){ const r=await fetch(url,{signal:AbortSignal.timeout(ms||9000)}); return r.json().catch(()=>({})); }
async function jpost(url,body,ms){ const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(ms||9000)}); return r.json().catch(()=>({})); }

exports.handler = async function () {
  const now = Date.now();
  if (now > NOTICE_SINCE_MS + WINDOW_MS) return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'expired' }) };

  // 1) Andre's today cohort → phone10 -> first name (re-derived each run).
  const cohort = {};
  try {
    const d = await jget(`${XANO}/get_tech_daily_dashboard?tech_id=3`, 15000);
    for (const it of (d.jobs || [])) {
      const c = it.customer || {}; const p = last10(c.phone || c.mobile);
      if (p) cohort[p] = (String(c.first_name || '').trim().split(/\s+/)[0]) || 'Customer';
    }
  } catch (_) {}
  if (!Object.keys(cohort).length) return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'no_cohort' }) };

  // 2) already-forwarded row ids (dedup).
  const fwded = new Set();
  try {
    const dd = await jget(`${XANO}/list_recent_event_log?action=andre_late_reply_forwarded&days_back=1&limit=200`, 9000);
    for (const r of (dd.items || [])) { const md = asObj(r.metadata); if (md.row_id != null) fwded.add(String(md.row_id)); }
  } catch (_) {}

  // 3) inbound replies -> forward the ones from the cohort inside the window.
  let inbound = [];
  try { const d = await jget(`${XANO}/list_recent_event_log?action=inbound_customer_sms_received&days_back=1&limit=400`, 12000); inbound = d.items || []; }
  catch (_) { return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'inbound_read_failed' }) }; }

  const forwarded = [];
  for (const r of inbound) {
    const rid = String(r.id != null ? r.id : '');
    if (!rid || fwded.has(rid)) continue;
    const md = asObj(r.metadata);
    const ts = Number(r.created_at || md.ts || md.at_ms || 0);
    if (!(ts >= NOTICE_SINCE_MS && ts <= NOTICE_SINCE_MS + WINDOW_MS)) continue;
    const p10 = last10(md.phone || md.recipient || md.from || md.to);
    if (!cohort[p10]) continue;
    const body = String(md.body_preview || md.body || md.text || md.message || '').trim().slice(0, 400);
    if (!body) continue;
    const first = cohort[p10];
    const fwd = `[Andre — running-behind reply] ${first} (…${p10.slice(-4)}): "${body}"`;
    try {
      await jpost(`${XANO}/send_sms`, { to: OWNER, message: fwd, recipient_role: 'owner', context_tag: 'andre_late_forward' }, 12000);
      await jpost(`${XANO}/record_event_log`, { action: 'andre_late_reply_forwarded', metadata_json: JSON.stringify({ row_id: rid, phone: p10.slice(-4), at_ms: now }) }, 9000);
      forwarded.push({ first, last4: p10.slice(-4) });
    } catch (_) {}
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'ran', cohort: Object.keys(cohort).length, forwarded }) };
};
