// servicepower-auto-accept — grabs new OPEN SquareTrade dispatches automatically so we
// never lose an offer to a slow accept. Scans the board for OPEN calls, accepts each one
// in our covered states (status-only ACCEPTED — the proven flow), logs it, and texts Teddy
// a digest of what it grabbed. Capacity is wide open, so taking them all is pure upside.
//
// KILL SWITCH: vault SERVICEPOWER_AUTO_ACCEPT='false' disables it. Default = ON.
//
//   scheduled (every 10 min)   accept new OPEN offers
//   GET ?dryrun=1              show what WOULD be accepted, accept nothing
//   GET ?days=N                board lookback (default 6)
'use strict';
const sp = require('./_lib/servicepower');
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');

const OWNER = '+16154855795';
const OUR_STATES = new Set(['TN', 'LA']);   // safety guard — we only cover TN + LA

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function windows(days, chunk) {
  const out = []; const now = Date.now(); const DAY = 86400000;
  const f = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()} 00:00:00`;
  for (let off = 0; off < days; off += chunk) out.push({ from: f(new Date(now - Math.min(off + chunk, days) * DAY)), to: f(new Date(now - off * DAY)) });
  return out;
}
const who = (c) => `${c.first_name || ''} ${c.last_name || ''}`.trim();

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dryrun === '1';
  if (String(await getSecret('SERVICEPOWER_AUTO_ACCEPT') || '').toLowerCase() === 'false') {
    return json(200, { ok: true, disabled: true, note: 'kill switch on (SERVICEPOWER_AUTO_ACCEPT=false)' });
  }
  if (!(await sp.isConfigured())) return json(200, { ok: false, error: 'ServicePower creds missing' });

  const days = Math.min(parseInt(q.days || '6', 10) || 6, 30);
  const startMs = Date.now(); const BUDGET = 22000;

  // 1) gather OPEN calls from the board (getCallInfo carries fss_call_id + mfg_id we need)
  const open = new Map();
  try {
    for (const w of windows(days, 2)) {
      if (Date.now() - startMs > BUDGET) break;
      const r = await sp.getCallInfo({ fromDateTime: w.from, toDateTime: w.to });
      for (const c of (r.calls || [])) {
        if (String(c.status || '').toUpperCase() !== 'OPEN' || !c.call_number) continue;
        if (!open.has(c.call_number)) open.set(c.call_number, c);
      }
    }
  } catch (e) { return json(200, { ok: false, error: 'board pull failed: ' + String((e && e.message) || e) }); }

  // 2) accept each OPEN call in our states
  const candidates = [...open.values()].filter((c) => !c.state || OUR_STATES.has(String(c.state).toUpperCase()));
  const accepted = [], failed = [], skipped = [];
  for (const c of candidates) {
    if (Date.now() - startMs > BUDGET) break;
    if (dry) { accepted.push({ call: c.call_number, who: who(c), appliance: c.brand || c.product, city: c.city, state: c.state }); continue; }
    if (!c.fss_call_id || !c.mfg_id) { skipped.push({ call: c.call_number, why: 'no fss/mfg' }); continue; }
    let res; try { res = await sp.updateCallInfo({ callNumber: c.call_number, callStatus: 'ACCEPTED', spCallStatusId: '3', fssCallId: c.fss_call_id, mfgId: c.mfg_id }); }
    catch (e) { failed.push({ call: c.call_number, error: String((e && e.message) || e) }); continue; }
    if (res.ok) {
      accepted.push({ call: c.call_number, who: who(c), appliance: c.brand || c.product, city: c.city, state: c.state });
      try { await crud.logEvent('sp_auto_accepted', { call: c.call_number, who: who(c), city: c.city, state: c.state, appliance: c.brand || c.product, fss: c.fss_call_id, at_ms: Date.now() }); } catch (_) {}
    } else failed.push({ call: c.call_number, err_code: res.err_code, err_desc: res.err_desc });
  }

  // 3) text Teddy a digest of what was grabbed
  if (!dry && accepted.length) {
    const body = `[ant] ✅ Auto-accepted ${accepted.length} SquareTrade job${accepted.length === 1 ? '' : 's'}:\n`
      + accepted.slice(0, 8).map((a) => `  • ${a.who || a.call} · ${a.appliance || ''} · ${a.city || ''} ${a.state || ''}`).join('\n');
    try { await sendSms(OWNER, body, 'owner', 'sp_auto_accept'); } catch (_) {}
  }

  return json(200, { ok: true, mode: dry ? 'dryrun' : 'live', open_found: open.size, accepted: accepted.length, failed: failed.length, skipped: skipped.length, accepted_list: accepted, failed: failed.slice(0, 5) });
};
