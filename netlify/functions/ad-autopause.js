// ad-autopause — safety timer for short paid AD TESTS. Runs daily on Netlify's own
// schedule (session-independent, can't be forgotten). Any campaign in TESTS whose
// end date has passed gets PAUSED automatically, so a "few-day test" can never quietly
// keep spending. Idempotent (pausing an already-paused campaign is a no-op).
//
//   (scheduled daily)          auto-pause anything past its end date
//   GET ?secret=<admin>        run now / preview state
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
const crud = require('./_lib/xano/metadata-crud');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// { campaign, label, pauseOnOrAfter (YYYY-MM-DD, CT) }. Add a row per test; remove
// after it's paused. Dates are inclusive of the last full day BEFORE this date.
const TESTS = [
  { campaign: '24072373387', label: 'Miami — Spanish DIY + Quick Check test', pauseOnOrAfter: '2026-07-30' },
];

function todayCT() { const p = {}; for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())) p[x.type] = x.value; return `${p.year}-${p.month}-${p.day}`; }

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const today = todayCT();
  const due = TESTS.filter((t) => today >= t.pauseOnOrAfter);
  if (!due.length) return json(200, { ok: true, today, paused: [], note: 'nothing due', tests: TESTS });

  const c = await ads.creds();
  const token = await ads.accessToken(c);
  const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const url = `https://googleads.googleapis.com/${c.version}/customers/${cid}/campaigns:mutate`;
  const results = [];
  for (const t of due) {
    const body = JSON.stringify({ operations: [{ update: { resourceName: `customers/${cid}/campaigns/${t.campaign}`, status: 'PAUSED' }, updateMask: 'status' }] });
    let r, d;
    try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body }); d = await r.json().catch(() => ({})); }
    catch (e) { results.push({ campaign: t.campaign, ok: false, error: String(e.message || e) }); continue; }
    if (!r.ok && r.status === 403 && c.managerId) { try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body }); d = await r.json().catch(() => ({})); } catch (_) {} }
    results.push({ campaign: t.campaign, label: t.label, ok: r.ok, error: r.ok ? null : ((d.error && d.error.message) || d) });
    if (r.ok) { try { await crud.logEvent('ad_test_autopaused', { campaign: t.campaign, label: t.label, at: today }); } catch (_) {} }
  }
  return json(200, { ok: true, today, paused: results });
};
