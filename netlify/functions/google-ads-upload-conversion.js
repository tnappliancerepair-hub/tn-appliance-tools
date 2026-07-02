// google-ads-upload-conversion — upload ONE offline conversion to Google Ads: "this
// ad click (gclid) turned into a booked / paid job worth $X." This is what teaches
// Google which clicks become real out-of-pocket jobs so it can optimize for them.
//
//   GET ?secret=<admin>&gclid=...&action=booked|paid&value=150&when_ms=...   manual test
//   (also called internally by google-ads-conversion-sweep)
'use strict';
const { getSecret, getSecretFresh } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// "yyyy-mm-dd hh:mm:ss-05:00" in America/Chicago (Google requires a TZ offset).
function ctDateTime(ms) {
  const d = new Date(Number(ms) || Date.now());
  const p = {}; for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d)) p[x.type] = x.value;
  let off = '-05:00';
  try { const o = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'shortOffset' }).formatToParts(d).find((z) => z.type === 'timeZoneName').value; const n = parseInt(o.replace(/[^0-9-]/g, ''), 10); off = (n < 0 ? '-' : '+') + String(Math.abs(n)).padStart(2, '0') + ':00'; } catch (_) {}
  const hh = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hh}:${p.minute}:${p.second}${off}`;
}

// shared so the sweep can call this directly
async function uploadConversion({ gclid, gbraid, wbraid, action, value, when_ms }) {
  const c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return { ok: false, error: 'not_configured' };
  // FRESH reads (not cached getSecret) — these IDs were vaulted after warm
  // containers had already cached the empty value, which silently no-op'd uploads.
  const cid = (await getSecretFresh('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const vaultKey = action === 'paid' ? 'GOOGLE_ADS_CONV_PAID' : 'GOOGLE_ADS_CONV_BOOKED';
  const conversionAction = await getSecretFresh(vaultKey);
  if (!conversionAction) return { ok: false, error: 'conversion action not set up — run google-ads-setup-conversions?apply=1' };
  if (!gclid && !gbraid && !wbraid) return { ok: false, error: 'no click id' };

  const token = await ads.accessToken(c);
  const conv = { conversionAction, conversionDateTime: ctDateTime(when_ms) };
  if (gclid) conv.gclid = gclid; else if (gbraid) conv.gbraid = gbraid; else conv.wbraid = wbraid;
  const v = Number(value) || 0;
  if (v > 0) { conv.conversionValue = v; conv.currencyCode = 'USD'; }

  const url = `https://googleads.googleapis.com/${c.version}/customers/${cid}:uploadClickConversions`;
  const body = JSON.stringify({ conversions: [conv], partialFailure: true });
  let r, d;
  try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body }); d = await r.json().catch(() => ({})); }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
  if (!r.ok && r.status === 403 && c.managerId) {
    try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body }); d = await r.json().catch(() => ({})); } catch (_) {}
  }
  const partialErr = d.partialFailureError && (d.partialFailureError.message || d.partialFailureError);
  const okResult = !!(d.results && d.results[0] && !partialErr);
  return { ok: r.ok && okResult, http: r.status, action, value: v, conversion_action: conversionAction, partial_error: partialErr || null, raw_error: r.ok ? null : (d.error && (d.error.message || d.error)) || d };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const res = await uploadConversion({
    gclid: q.gclid, gbraid: q.gbraid, wbraid: q.wbraid,
    action: q.action === 'paid' ? 'paid' : 'booked',
    value: q.value, when_ms: q.when_ms || Date.now(),
  });
  return json(200, res);
};

exports.uploadConversion = uploadConversion;
