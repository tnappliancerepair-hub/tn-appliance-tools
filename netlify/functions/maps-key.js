// maps-key — serves the PUBLIC, referrer-restricted Google Maps browser key to
// the booking pages for address autocomplete. Browser keys are meant to live in
// client HTML; the protection is the HTTP-referrer restriction (set in Google
// Cloud), NOT secrecy. Returns {key:''} until GOOGLE_MAPS_BROWSER_KEY is vaulted,
// so the forms degrade to plain manual entry with zero breakage.
'use strict';
const { getSecret } = require('./_lib/secrets');

exports.handler = async function () {
  let key = '';
  try { key = (await getSecret('GOOGLE_MAPS_BROWSER_KEY')) || ''; } catch (_) {}
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' },
    body: JSON.stringify({ key: String(key || '').trim() }),
  };
};
