// google-ads-gtag-config — serve the PUBLIC Google Ads gtag id + conversion
// send_to labels to the browser so the intake + thank-you pages can fire
// client-side conversions. These values are public by design (they appear in
// every advertiser's page source), so no auth is needed. Cached at the edge.
//   GET -> { ok, gtag_id, booked_send_to, paid_send_to }
'use strict';
const { getSecret } = require('./_lib/secrets');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' };

exports.handler = async function () {
  const [gtag, booked, paid] = await Promise.all([
    getSecret('GOOGLE_ADS_GTAG_ID'), getSecret('GOOGLE_ADS_WEB_BOOKED_SENDTO'), getSecret('GOOGLE_ADS_WEB_PAID_SENDTO'),
  ]);
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: !!gtag, gtag_id: gtag || '', booked_send_to: booked || '', paid_send_to: paid || '' }) };
};
