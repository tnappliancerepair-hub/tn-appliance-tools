// _lib/fedex.js — FedEx REST API connector (developer.fedex.com).
// OAuth2 client_credentials + the pieces TN Appliance needs for the returns pile:
//   • schedule a PICKUP (driver comes to the shop for the labeled return boxes)
//   • check pickup availability
//   • cancel a pickup
//   • track packages (to auto-close returns as they're delivered)
//
// Vault creds (set via admin-secrets.html): FEDEX_CLIENT_ID, FEDEX_CLIENT_SECRET,
// FEDEX_ACCOUNT_NUMBER, FEDEX_ENV ('sandbox' default | 'production'). Until they're
// set, configured() is false and callers return a friendly not_configured.
'use strict';
const { getSecret } = require('./secrets');

const BASES = { sandbox: 'https://apis-sandbox.fedex.com', production: 'https://apis.fedex.com' };

// Shop origin (pickup location). Overridable via vault FEDEX_PICKUP_* if it ever moves.
const SHOP = {
  companyName: 'TN Appliance Exchange LLC',
  personName: 'TN Appliance Exchange',
  phoneNumber: '6152802949',
  streetLines: ['3137 Skinner Dr'],
  city: 'Antioch', stateOrProvinceCode: 'TN', postalCode: '37013', countryCode: 'US',
};

let _tok = { v: '', exp: 0 };

async function cfg() {
  const [id, secret, account, envRaw] = await Promise.all([
    getSecret('FEDEX_CLIENT_ID'), getSecret('FEDEX_CLIENT_SECRET'),
    getSecret('FEDEX_ACCOUNT_NUMBER'), getSecret('FEDEX_ENV'),
  ]);
  const env = String(envRaw || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
  return { id, secret, account, env, base: BASES[env] };
}
async function configured() { const c = await cfg(); return !!(c.id && c.secret); }

async function token() {
  if (_tok.v && Date.now() < _tok.exp) return _tok.v;
  const c = await cfg();
  if (!c.id || !c.secret) throw new Error('fedex_not_configured');
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: c.id, client_secret: c.secret });
  const r = await fetch(`${c.base}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(), signal: AbortSignal.timeout(12000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error('fedex_auth_failed: ' + JSON.stringify(d).slice(0, 200));
  _tok = { v: d.access_token, exp: Date.now() + (Math.max(60, (d.expires_in || 3600) - 120) * 1000) };
  return _tok.v;
}

async function api(path, body, method) {
  const c = await cfg();
  const t = await token();
  const r = await fetch(`${c.base}${path}`, {
    method: method || 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', 'X-locale': 'en_US' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const raw = await r.text();
  let d = {}; try { d = JSON.parse(raw); } catch (_) {}
  return { ok: r.ok, status: r.status, data: d, raw: raw.slice(0, 500) };
}

async function diag() { const c = await cfg(); return { configured: !!(c.id && c.secret), has_account: !!c.account, env: c.env }; }

// ---- Pickup availability ----  (opts tunable while we dial in FedEx sandbox)
async function pickupAvailability({ date, readyTime, closeTime, carriers, requestType, businessDays }) {
  const c = await cfg();
  const reqType = requestType ? [requestType] : ['FUTURE_DAY'];
  const body = {
    pickupAddress: {
      streetLines: SHOP.streetLines, city: SHOP.city, stateOrProvinceCode: SHOP.stateOrProvinceCode,
      postalCode: SHOP.postalCode, countryCode: SHOP.countryCode, residential: false,
    },
    dispatchDate: date,                       // YYYY-MM-DD
    packageReadyTime: readyTime || '10:00:00',
    customerCloseTime: closeTime || '17:00:00',
    pickupRequestType: reqType,
    carriers: carriers ? (Array.isArray(carriers) ? carriers : String(carriers).split(',')) : ['FDXE'],
    countryRelationship: 'DOMESTIC',
  };
  if (reqType.includes('FUTURE_DAY')) body.numberOfBusinessDays = Number(businessDays) || 5;
  if (c.account) body.associatedAccountNumber = { value: c.account };   // omit if empty (empty = invalid input)
  return { req: body, ...(await api('/pickup/v1/pickups/availabilities', body)) };
}

// ---- Schedule a pickup ----
async function schedulePickup({ date, readyTime, closeTime, packageCount, weightLbs, carrierCode, remarks, packageLocation }) {
  const c = await cfg();
  const ready = `${date}T${(readyTime || '10:00:00')}`;   // local ISO, no offset (FedEx accepts naive-local)
  const body = {
    originDetail: {
      packageLocation: packageLocation || 'FRONT',   // where the boxes are for the driver (required)
      pickupLocation: {
        contact: { companyName: SHOP.companyName, personName: SHOP.personName, phoneNumber: SHOP.phoneNumber },
        address: {
          streetLines: SHOP.streetLines, city: SHOP.city, stateOrProvinceCode: SHOP.stateOrProvinceCode,
          postalCode: SHOP.postalCode, countryCode: SHOP.countryCode, residential: false,
        },
      },
      readyDateTimestamp: ready,
      customerCloseTime: closeTime || '17:00:00',
    },
    totalWeight: { units: 'LB', value: Number(weightLbs) || 30 },
    packageCount: Number(packageCount) || 1,
    carrierCode: carrierCode || 'FDXG',          // Ground = typical for warranty returns
    remarks: remarks || 'Warranty parts returns',
    countryRelationship: 'DOMESTIC',
  };
  if (c.account) body.associatedAccountNumber = { value: c.account };
  return api('/pickup/v1/pickups', body);
}

// ---- Cancel a pickup ----
async function cancelPickup({ confirmationNumber, scheduledDate, carrierCode }) {
  const c = await cfg();
  return api('/pickup/v1/pickups/cancel', {
    associatedAccountNumber: { value: c.account || '' },
    pickupConfirmationCode: confirmationNumber,
    scheduledDate,
    location: '',
    carrierCode: carrierCode || 'FDXG',
    remarks: 'Cancelled from Ant office',
  }, 'PUT');
}

// ---- Track packages ----
async function track(trackingNumbers) {
  const list = (Array.isArray(trackingNumbers) ? trackingNumbers : [trackingNumbers]).filter(Boolean).slice(0, 30);
  return api('/track/v1/trackingnumbers', {
    trackingInfo: list.map((n) => ({ trackingNumberInfo: { trackingNumber: String(n).trim() } })),
    includeDetailedScans: false,
  });
}

module.exports = { configured, diag, cfg, token, api, pickupAvailability, schedulePickup, cancelPickup, track, SHOP };
