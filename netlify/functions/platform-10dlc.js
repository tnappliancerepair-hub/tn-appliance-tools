// platform-10dlc — carrier registration, per tenant, done for them.
//
// WHY THIS EXISTS: our own Telnyx campaign is registered to the brand
// "TN Appliance Exchange LLC". If a tenant shop texted their customers over that
// campaign they'd be sending under OUR identity — and one tenant's complaint
// would suspend the campaign that carries 588-9500, 857-8800 and 280-2949. We'd
// lose our own shop's texting to a stranger's mistake. So every tenant gets their
// own brand + campaign, and the blast radius stays one tenant wide.
//
// The shop supplies only what nobody else can: legal name, EIN, entity type,
// address, contact. We supply the part that actually gets applications rejected —
// the sample messages and the opt-in description — because our templates are
// already written and our opt-in flow is the one carriers want to see.
//
//   POST { action:'submit',  access_token|secret, company_id?, legal_name, ein,
//          entity_type, street, city, state, postal_code, contact_email,
//          contact_phone, website? }
//   POST { action:'status'  } -> where this tenant stands
//   POST { action:'refresh' } -> re-poll Telnyx, flip to approved when it clears
//   POST { action:'assign'  } -> put the tenant's own number on their campaign
//   GET  ?action=probe&secret=  -> read-only: does our Telnyx 10DLC access work
//
// SHADOW by default. With PLATFORM_10DLC_LIVE != 'true' nothing is created and no
// money moves — it returns the EXACT body it would POST, so the field shapes can be
// checked against Telnyx's docs before a single registration is filed. Registration
// costs real money per brand and per month per campaign; a wrong field silently
// rejected is worse than a slow one verified.
'use strict';

const { getSecret } = require('./_lib/secrets');
const { platform } = require('./_lib/platform-rest');
const comms = require('./_lib/comms');

const TELNYX = 'https://api.telnyx.com/v2';

function J(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

async function tx(method, path, body) {
  const key = process.env.TELNYX_API_KEY || (await getSecret('TELNYX_API_KEY'));
  if (!key) return { ok: false, status: 0, data: { error: 'TELNYX_API_KEY not set' } };
  const r = await fetch(TELNYX + path, {
    method, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: d };
}

// Same auth shape as platform-phone: the owner's own Supabase session, or an
// admin secret naming the company (for support + automation).
async function companyFromToken(token) {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!url || !key || !token) return null;
  const r = await fetch(url.replace(/\/+$/, '') + '/auth/v1/user', {
    headers: { apikey: key, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  if (!u || !u.id) return null;
  const pf = await platform();
  const rows = await pf.get(`app_user?auth_user_id=eq.${encodeURIComponent(u.id)}&role=eq.owner&select=company_id&limit=1`);
  return (rows && rows[0] && rows[0].company_id) || null;
}

const digits = (s) => String(s || '').replace(/\D/g, '');
const e164 = (s) => { const d = digits(s); return d.length === 10 ? '+1' + d : (d ? '+' + d : ''); };

// TCR entity types. A repair shop is almost always one of the first two; the rest
// are here so the picker never forces someone to lie about what they are.
const ENTITY_TYPES = ['PRIVATE_PROFIT', 'SOLE_PROPRIETOR', 'NON_PROFIT', 'PUBLIC_PROFIT', 'GOVERNMENT'];

// The opt-in story, written once, for every tenant. This is the field applications
// die on: carriers want to know exactly how a human agreed to be texted, and a vague
// answer reads as a list someone bought. Ours is genuinely clean, so we say it plainly.
const MESSAGE_FLOW =
  'Customers opt in one of three ways, all of them initiated by the customer: (1) they text the ' +
  'business directly at its published number; (2) they give their mobile number when booking a ' +
  'repair on the business website or over the phone and agree to receive service updates about ' +
  'that repair; or (3) they give it to the technician on site. Every message is a transactional ' +
  'update about that customer\'s own repair job — appointment confirmations, day-before reminders, ' +
  'a note when the technician is on the way, and the receipt when the work is done. No marketing, ' +
  'no purchased lists, no third-party sharing. Every thread honors STOP to opt out and HELP for help.';

const HELP_MESSAGE = 'Reply STOP to stop receiving texts. Msg&data rates may apply.';
const OPTOUT_MESSAGE = 'You are unsubscribed and will get no further texts from us. Reply START to resume.';

// Real sample messages, rendered from the templates the tenant will actually send.
// Using our live copy (not invented samples) is what keeps the application honest —
// and it's why we can fill this in for them at all.
function sampleMessages(shopName) {
  const v = { first: 'Sarah', shop: shopName || 'the shop', tech: 'Jimmy', day: 'Thursday', unit: 'Whirlpool dryer', link: 'https://example.com/r/abc123', review: 'https://example.com/review', problem: 'not heating' };
  const keys = ['reminder', 'otw', 'arrived', 'complete', 'offer'];
  const out = {};
  keys.forEach((k, i) => {
    let text = '';
    try { text = comms.msg({}, k, v) || ''; } catch (_) { text = ''; }
    if (!text) { try { text = comms.render(comms.DEFAULTS[k].text, v); } catch (_) { text = ''; } }
    if (text) out['sample' + (i + 1)] = text;
  });
  return out;
}

function brandBody(company, b) {
  return {
    entityType: b.entity_type,
    displayName: company.name || b.legal_name,
    companyName: b.legal_name,
    ein: digits(b.ein),
    einIssuingCountry: 'US',
    country: 'US',
    email: b.contact_email,
    phone: e164(b.contact_phone),
    street: b.street,
    city: b.city,
    state: String(b.state || '').toUpperCase().slice(0, 2),
    postalCode: digits(b.postal_code).slice(0, 5),
    vertical: 'PROFESSIONAL',
    website: b.website || undefined,
  };
}

function campaignBody(brandId, company) {
  return Object.assign({
    brandId,
    usecase: 'CUSTOMER_CARE',
    description:
      `Transactional service updates from ${company.name || 'the business'} to its own repair customers: ` +
      'appointment confirmations and reminders, technician on-the-way notices, parts status, and the ' +
      'receipt when the job is complete.',
    messageFlow: MESSAGE_FLOW,
    subscriberOptin: true,
    subscriberOptout: true,
    subscriberHelp: true,
    helpMessage: HELP_MESSAGE,
    optoutMessage: OPTOUT_MESSAGE,
    helpKeywords: 'HELP',
    optoutKeywords: 'STOP',
    optinKeywords: 'START',
    autoRenewal: true,
  }, sampleMessages(company.name));
}

// Everything we keep about a tenant's registration. Deliberately NOT the EIN —
// it goes to Telnyx and nowhere else; we hold the last four so support can confirm
// which number was filed without the row being worth stealing.
function stateOf(company) {
  const s = (company.settings && company.settings.texting) || {};
  return {
    status: s.status || 'not_started',
    brand_id: s.brand_id || null,
    campaign_id: s.campaign_id || null,
    legal_name: s.legal_name || null,
    ein_last4: s.ein_last4 || null,
    entity_type: s.entity_type || null,
    submitted_at: s.submitted_at || null,
    approved_at: s.approved_at || null,
    last_checked_at: s.last_checked_at || null,
    reason: s.reason || null,
  };
}

async function saveState(pf, companyId, company, patch) {
  const settings = Object.assign({}, company.settings || {});
  settings.texting = Object.assign({}, settings.texting || {}, patch);
  await pf.patch('company', `id=eq.${encodeURIComponent(companyId)}`, { settings });
  return settings.texting;
}

// Texting is OFF until the carrier says yes. Voice never waits on any of this.
function textingAllowed(company) {
  return ((company && company.settings && company.settings.texting && company.settings.texting.status) || '') === 'approved';
}

const LIVE = () => String(process.env.PLATFORM_10DLC_LIVE || '') === 'true';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let b = {};
  try { b = event.body ? JSON.parse(event.body) : {}; } catch (_) { b = {}; }
  const action = String(b.action || q.action || 'status');
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const isAdmin = (b.secret || q.secret) === admin;

  // Read-only connectivity check — proves our Telnyx 10DLC access before anyone
  // files anything, and never touches a tenant.
  if (action === 'probe') {
    if (!isAdmin) return J(401, { ok: false, error: 'unauthorized' });
    const r = await tx('GET', '/10dlc/brand?page[number]=1&page[size]=10');
    const rows = (r.data && (r.data.records || r.data.data)) || [];
    return J(200, {
      ok: r.ok, status: r.status, live: LIVE(),
      brands: rows.map((x) => ({ id: x.brandId || x.id, name: x.displayName || x.companyName, status: x.identityStatus || x.status })),
      note: LIVE() ? 'LIVE — submits create real registrations and cost money.' : 'SHADOW — submits return the exact body without creating anything.',
    });
  }

  const pf = await platform();
  if (!pf) return J(200, { ok: false, error: 'platform not configured' });

  let companyId = null;
  if (isAdmin && (b.company_id || q.company_id)) companyId = b.company_id || q.company_id;
  else companyId = await companyFromToken(b.access_token || q.access_token || '');
  if (!companyId) return J(401, { ok: false, error: 'unauthorized' });

  const rows = await pf.get(`company?id=eq.${encodeURIComponent(companyId)}&select=id,name,slug,settings&limit=1`);
  const company = rows && rows[0];
  if (!company) return J(404, { ok: false, error: 'company not found' });

  if (action === 'status') {
    const st = stateOf(company);
    // Pre-fill everything we already hold so the shop is only asked for what nobody
    // else can supply. Today that's the EIN, their entity type, and a street address
    // (we keep a phone and an area code, never a mailing address).
    const biz = (company.settings && company.settings.business) || {};
    let ownerEmail = '';
    try {
      const ur = await pf.get(`app_user?company_id=eq.${encodeURIComponent(companyId)}&role=eq.owner&select=email&limit=1`);
      ownerEmail = (ur && ur[0] && ur[0].email) || '';
    } catch (_) { ownerEmail = ''; }
    return J(200, {
      ok: true, live: LIVE(), texting_allowed: textingAllowed(company), state: st,
      entity_types: ENTITY_TYPES,
      prefill: { legal_name: company.name || '', contact_phone: biz.phone || '', contact_email: ownerEmail },
      needs: st.status === 'not_started'
        ? ['legal_name', 'ein', 'entity_type', 'street', 'city', 'state', 'postal_code', 'contact_email', 'contact_phone']
        : [],
    });
  }

  if (action === 'submit') {
    const st = stateOf(company);
    if (st.status === 'approved') return J(200, { ok: true, already: true, state: st });
    if (st.brand_id && st.status !== 'rejected') return J(200, { ok: true, already: true, state: st, note: 'already filed — use action=refresh to check on it' });

    const need = ['legal_name', 'ein', 'entity_type', 'street', 'city', 'state', 'postal_code', 'contact_email', 'contact_phone'];
    const missing = need.filter((k) => !String(b[k] || '').trim());
    if (missing.length) return J(200, { ok: false, error: 'missing_fields', missing });
    if (!ENTITY_TYPES.includes(b.entity_type)) return J(200, { ok: false, error: 'bad_entity_type', entity_types: ENTITY_TYPES });
    if (digits(b.ein).length !== 9) return J(200, { ok: false, error: 'ein_must_be_9_digits' });

    const bBody = brandBody(company, b);
    const ein4 = digits(b.ein).slice(-4);

    if (!LIVE()) {
      return J(200, {
        ok: true, shadow: true,
        would_post: { brand: { path: '/10dlc/brand', body: Object.assign({}, bBody, { ein: '*****' + ein4 }) }, campaign: { path: '/10dlc/campaign', body: campaignBody('<brandId from step 1>', company) } },
        note: 'PLATFORM_10DLC_LIVE != true — nothing filed, nothing charged. Check these field names against Telnyx docs, then flip it on.',
      });
    }

    const br = await tx('POST', '/10dlc/brand', bBody);
    const brandId = br.data && (br.data.brandId || br.data.id || (br.data.data && (br.data.data.brandId || br.data.data.id)));
    if (!br.ok || !brandId) {
      return J(200, { ok: false, step: 'brand', status: br.status, error: JSON.stringify(br.data && (br.data.errors || br.data)).slice(0, 400) });
    }

    const cp = await tx('POST', '/10dlc/campaign', campaignBody(brandId, company));
    const campaignId = cp.data && (cp.data.campaignId || cp.data.id || (cp.data.data && (cp.data.data.campaignId || cp.data.data.id)));

    // The brand landing is the milestone worth keeping even if the campaign call
    // needs another pass — losing the brand id would mean paying to register twice.
    const saved = await saveState(pf, companyId, company, {
      status: campaignId ? 'pending_review' : 'submitted',
      brand_id: brandId, campaign_id: campaignId || null,
      legal_name: b.legal_name, ein_last4: ein4, entity_type: b.entity_type,
      submitted_at: new Date().toISOString(), reason: null,
    });

    return J(200, {
      ok: true, state: saved,
      campaign_error: campaignId ? undefined : JSON.stringify(cp.data && (cp.data.errors || cp.data)).slice(0, 400),
      note: 'Filed. Brand usually verifies within hours; campaign review is typically 1-3 business days.',
    });
  }

  if (action === 'refresh') {
    const st = stateOf(company);
    if (!st.brand_id) return J(200, { ok: true, state: st, note: 'nothing filed yet' });

    const br = await tx('GET', `/10dlc/brand/${encodeURIComponent(st.brand_id)}`);
    const bd = (br.data && (br.data.data || br.data)) || {};
    const brandStatus = String(bd.identityStatus || bd.status || '').toUpperCase();

    let campStatus = '';
    if (st.campaign_id) {
      const cp = await tx('GET', `/10dlc/campaign/${encodeURIComponent(st.campaign_id)}`);
      const cd = (cp.data && (cp.data.data || cp.data)) || {};
      campStatus = String(cd.status || cd.campaignStatus || '').toUpperCase();
    }

    // Approved means BOTH cleared. A verified brand with a campaign still in review
    // cannot legally send, and reporting it as ready would put the tenant on the air
    // with texts the carriers will drop.
    const brandOk = ['VERIFIED', 'VETTED_VERIFIED', 'ACTIVE'].includes(brandStatus);
    const campOk = ['ACTIVE', 'APPROVED', 'REGISTERED'].includes(campStatus);
    const rejected = ['FAILED', 'REJECTED', 'EXPIRED'].includes(brandStatus) || ['FAILED', 'REJECTED', 'EXPIRED'].includes(campStatus);

    const patch = { last_checked_at: new Date().toISOString() };
    if (rejected) { patch.status = 'rejected'; patch.reason = `brand=${brandStatus || 'n/a'} campaign=${campStatus || 'n/a'}`; }
    else if (brandOk && campOk) { patch.status = 'approved'; patch.approved_at = new Date().toISOString(); patch.reason = null; }
    else { patch.status = 'pending_review'; }

    const saved = await saveState(pf, companyId, company, patch);
    return J(200, { ok: true, state: saved, brand_status: brandStatus, campaign_status: campStatus, texting_allowed: saved.status === 'approved' });
  }

  if (action === 'assign') {
    const st = stateOf(company);
    if (st.status !== 'approved') return J(200, { ok: false, error: 'not_approved', state: st });
    const number = ((company.settings && company.settings.phone && company.settings.phone.number) || '');
    if (!number) return J(200, { ok: false, error: 'no_number', note: 'the shop has no phone line yet — platform-phone action=provision first' });

    if (!LIVE()) return J(200, { ok: true, shadow: true, would_assign: { number, campaign_id: st.campaign_id } });

    const r = await tx('POST', '/10dlc/phone_number_campaigns', { phoneNumber: number, campaignId: st.campaign_id });
    return J(200, { ok: r.ok, status: r.status, number, campaign_id: st.campaign_id, error: r.ok ? undefined : JSON.stringify(r.data && (r.data.errors || r.data)).slice(0, 300) });
  }

  return J(400, { ok: false, error: 'unknown action', actions: ['status', 'submit', 'refresh', 'assign', 'probe'] });
};

exports.textingAllowed = textingAllowed;
exports.ENTITY_TYPES = ENTITY_TYPES;
