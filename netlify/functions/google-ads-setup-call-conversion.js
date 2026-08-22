// google-ads-setup-call-conversion — turn on CALL conversion tracking for the
// call-driven After-Hours campaign (Teddy 2026-08-22). The web pipeline never
// fired because the conversions here are PHONE CALLS, not web forms — and calls
// weren't being counted, so Google was optimizing blind on cheap clicks.
//
// Does two API things (preview-first, apply-gated):
//   1) Enable ACCOUNT call reporting (customer.call_reporting_setting
//      .call_conversion_reporting_enabled = true) — lets Google swap a forwarding
//      number into the ad's call asset and record call durations.
//   2) Create an AD_CALL conversion action "Ant — Phone Call (60s+)" — a call from
//      an ad that lasts >= 60s counts as a conversion (PHONE_CALL_LEAD).
//
// After this + a call asset on the campaign (google-ads-set-call-number), Google
// optimizes toward calls-that-book instead of clicks. Vaults the action resource.
//
//   GET ?secret=<admin>            preview (writes nothing)
//   GET ?secret=<admin>&apply=1    enable reporting + create the AD_CALL action
'use strict';
const ads = require('./_lib/google-ads');
let getSecret, setSecret; try { ({ getSecret, setSecret } = require('./_lib/secrets')); } catch (_) {}
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const json = (c, b) => ({ statusCode: c, headers: CORS, body: JSON.stringify(b) });

const ACTION_NAME = 'Ant — Phone Call (60s+)';
const MIN_SECONDS = 60;

async function gaql(c, token, cid, query, loginCid) {
  const url = `https://googleads.googleapis.com/${c.version}/customers/${cid}/googleAds:search`;
  const r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, loginCid), body: JSON.stringify({ query }) });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, d };
}

exports.handler = async function (event) {
  try {
    const q = event.queryStringParameters || {};
    const admin = (getSecret && (await getSecret('VAPI_ADMIN_SECRET'))) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

    const c = await ads.creds();
    const token = await ads.accessToken(c);
    const cid = (q.cid ? String(q.cid) : (getSecret && (await getSecret('GOOGLE_ADS_CONV_CID')))) || '9267688121';
    const cidDigits = cid.replace(/\D/g, '');

    // ── Read current state: call reporting flag + any existing AD_CALL action ──
    let reportingOn = null, existingAdCall = null;
    const rep = await gaql(c, token, cidDigits, 'SELECT customer.call_reporting_setting.call_conversion_reporting_enabled FROM customer', cidDigits);
    if (rep.ok) { try { reportingOn = !!rep.d.results[0].customer.callReportingSetting.callConversionReportingEnabled; } catch (_) { reportingOn = false; } }
    const ca = await gaql(c, token, cidDigits, "SELECT conversion_action.resource_name, conversion_action.name, conversion_action.type, conversion_action.status FROM conversion_action WHERE conversion_action.type = 'AD_CALL'", cidDigits);
    if (ca.ok) { const hit = (ca.d.results || []).map((x) => x.conversionAction).find(Boolean); if (hit) existingAdCall = hit; }

    const apply = q.apply === '1' || q.apply === 'true';
    if (!apply) {
      return json(200, {
        ok: true, mode: 'preview', cid: cidDigits,
        current: { call_reporting_enabled: reportingOn, existing_ad_call_action: existingAdCall || null },
        would: {
          enable_call_reporting: reportingOn !== true,
          create_ad_call_action: !existingAdCall ? { name: ACTION_NAME, type: 'AD_CALL', category: 'PHONE_CALL_LEAD', min_call_seconds: MIN_SECONDS } : 'already exists',
        },
        note: 'add &apply=1 to enable account call reporting + create the AD_CALL action. Then add the call asset with google-ads-set-call-number and confirm the forwarding number in the Ads console.',
      });
    }

    const out = { ok: true, mode: 'apply', cid: cidDigits, steps: {} };

    // ── 1) Enable account call reporting (CustomerService.MutateCustomer) ──
    if (reportingOn !== true) {
      const url = `https://googleads.googleapis.com/${c.version}/customers/${cidDigits}:mutate`;
      const body = JSON.stringify({ operation: { update: { resourceName: `customers/${cidDigits}`, callReportingSetting: { callConversionReportingEnabled: true } }, updateMask: 'call_reporting_setting.call_conversion_reporting_enabled' } });
      let r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, cidDigits), body });
      let d = await r.json().catch(() => ({}));
      if (!r.ok && r.status === 403 && c.managerId) { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body }); d = await r.json().catch(() => ({})); }
      out.steps.enable_call_reporting = r.ok ? 'enabled' : { http: r.status, error: (d.error && (d.error.message || d.error.status)) || d };
      if (!r.ok) out.ok = false;
    } else out.steps.enable_call_reporting = 'already on';

    // ── 2) Create the AD_CALL conversion action ──
    if (!existingAdCall) {
      const url = `https://googleads.googleapis.com/${c.version}/customers/${cidDigits}/conversionActions:mutate`;
      const op = { create: {
        name: ACTION_NAME, type: 'AD_CALL', category: 'PHONE_CALL_LEAD', status: 'ENABLED',
        countingType: 'ONE_PER_CLICK',
        phoneCallDurationSeconds: MIN_SECONDS,
        valueSettings: { defaultValue: 0, alwaysUseDefaultValue: false },
      } };
      const body = JSON.stringify({ operations: [op] });
      let r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, cidDigits), body });
      let d = await r.json().catch(() => ({}));
      if (!r.ok && r.status === 403 && c.managerId) { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body }); d = await r.json().catch(() => ({})); }
      if (r.ok) {
        const rn = d.results && d.results[0] && d.results[0].resourceName;
        out.steps.create_ad_call_action = rn || 'created';
        if (rn) { try { await setSecret('GOOGLE_ADS_CONV_CALL', rn); await setSecret('GOOGLE_ADS_CONV_CALL_ID', rn.split('/').pop()); } catch (_) {} }
      } else { out.ok = false; out.steps.create_ad_call_action = { http: r.status, error: (d.error && (d.error.message || d.error.status)) || d, detail: (d.error && d.error.details && d.error.details[0] && d.error.details[0].errors) || null }; }
    } else out.steps.create_ad_call_action = 'already exists: ' + (existingAdCall.resourceName || existingAdCall.name);

    out.next = 'Add the call asset: google-ads-set-call-number?secret=&apply=1&phone=<ads line>. Then in Google Ads console confirm the Google forwarding number provisioned on the call asset (that piece isn\'t API-visible).';
    return json(200, out);
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
