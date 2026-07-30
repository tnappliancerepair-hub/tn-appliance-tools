// fedex-track — owner-gated. Track FedEx numbers (the return-label tracking #s),
// return a clean per-package status so the returns pile can be ticked down as boxes
// get scanned/delivered.
//   GET  ?secret=<admin>&numbers=123,456
//   POST {secret, numbers:[...]}
'use strict';
const fedex = require('./_lib/fedex');
const { getSecret } = require('./_lib/secrets');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if ((q.secret || b.secret) !== admin) return json(401, { ok: false, error: 'unauthorized' });

  if (!(await fedex.configured())) return json(200, { ok: false, configured: false, error: 'FedEx not connected yet.' });

  const nums = (b.numbers || String(q.numbers || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
  if (!nums.length) return json(400, { ok: false, error: 'pass numbers=123,456' });

  try {
    const r = await fedex.track(nums);
    const results = ((r.data && r.data.output && r.data.output.completeTrackResults) || []).map((t) => {
      const tr = (t.trackResults && t.trackResults[0]) || {};
      const st = tr.latestStatusDetail || {};
      const delivered = /delivered/i.test(st.statusByLocale || st.description || st.code || '');
      return {
        tracking: t.trackingNumber,
        status: st.statusByLocale || st.description || 'unknown',
        code: st.code || '',
        delivered,
        when: (tr.dateAndTimes && (tr.dateAndTimes.find((x) => /ACTUAL_DELIVERY|ESTIMATED_DELIVERY/.test(x.type)) || {}).dateTime) || '',
      };
    });
    return json(200, { ok: r.ok, configured: true, count: results.length, results, delivered: results.filter((x) => x.delivered).length });
  } catch (e) {
    return json(200, { ok: false, configured: true, error: String((e && e.message) || e) });
  }
};
