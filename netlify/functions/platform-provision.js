// platform-provision — stand up a NEW full tenant on the Ant multi-tenant platform
// (Supabase "ANT Platforms"). Server-side, using the SERVICE key from the vault, which
// bypasses RLS — so we can create the owner's login + the company + the owner app_user
// link in one shot (create_company_with_owner needs a logged-in caller; this doesn't).
// Admin-gated. Idempotent: re-running with the same slug/email reuses what exists.
//
//   ?action=provision&secret=<admin>
//     &slug=classic-automotive&name=Classic%20Automotive&trade=automotive
//     &owner_email=Gllong178@gmail.com&owner_name=Greg%20Long&owner_phone=+16158549602
//     &plan=office&area=Lebanon,%20TN
//   -> creates the login + company, returns { company, login:{email,temp_password}, slug }
// The owner then signs into /platform/office-board.html with that email + temp password.
'use strict';
const { getSecret } = require('./_lib/secrets');
const { createLeadJob } = require('./_lib/platform-db');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function tempPassword() { return 'Ant-' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89); }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== guard) return { statusCode: 403, body: 'forbidden' };

  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!url || !key) return json(200, { ok: false, error: 'platform not configured (PLATFORM_SUPABASE_URL / PLATFORM_SUPABASE_SERVICE_KEY)' });

  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  const rest = async (path, opts = {}) => {
    const r = await fetch(`${url}/rest/v1/${path}`, { headers: { ...H, ...(opts.headers || {}) }, method: opts.method || 'GET', body: opts.body, signal: AbortSignal.timeout(10000) });
    const d = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, d };
  };

  const rest0 = async (path) => { const r = await fetch(`${url}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(10000) }); return r.ok ? r.json().catch(() => []) : []; };

  // Diagnostic: list every tenant + its owner login, to confirm isolation.
  if (q.action === 'tenants') {
    const companies = await rest0('company?select=id,slug,name,trade,plan,created_at&order=created_at.asc');
    const users = await rest0('app_user?select=company_id,role,email,active&order=created_at.asc');
    const byCo = {};
    (Array.isArray(users) ? users : []).forEach((u) => { (byCo[u.company_id] = byCo[u.company_id] || []).push({ email: u.email, role: u.role, active: u.active }); });
    const jc = await rest0('job?select=company_id');
    const jobCount = {};
    (Array.isArray(jc) ? jc : []).forEach((j) => { jobCount[j.company_id] = (jobCount[j.company_id] || 0) + 1; });
    const out = (Array.isArray(companies) ? companies : []).map((c) => ({ slug: c.slug, name: c.name, trade: c.trade, plan: c.plan, jobs: jobCount[c.id] || 0, logins: byCo[c.id] || [] }));
    return json(200, { ok: true, tenants: out });
  }

  // Diagnostic: the newest lead for a shop + its intake state (media, waiver, availability)
  // and the customer's intake link — to verify a test call end-to-end. ?action=lastlead&slug=…
  if (q.action === 'lastlead') {
    const slug = String(q.slug || '').toLowerCase().trim();
    if (!slug) return json(200, { ok: false, error: 'slug required' });
    const cos = await rest0(`company?slug=eq.${encodeURIComponent(slug)}&select=id,name&limit=1`);
    const co = cos && cos[0];
    if (!co) return json(200, { ok: false, error: 'unknown shop: ' + slug });
    const jobs = await rest0(`job?company_id=eq.${co.id}&order=created_at.desc&limit=1&select=id,problem,status,availability,waiver_signed_at,waiver_name,intake_done_at,created_at,customer:customer_id(first_name,last_name,phone),unit:unit_id(label)`);
    const job = jobs && jobs[0];
    if (!job) return json(200, { ok: true, shop: co.name, lead: null });
    const media = await rest0(`job_media?job_id=eq.${job.id}&select=kind,provider,ref`);
    const grants = await rest0(`portal_grant?job_id=eq.${job.id}&order=created_at.desc&limit=1&select=token`);
    const token = grants && grants[0] && grants[0].token;
    const hasVideo = (media || []).some((m) => m.kind === 'video');
    const hasPhoto = (media || []).some((m) => m.kind === 'photo');
    return json(200, { ok: true, shop: co.name, lead: {
      job_id: job.id, created_at: job.created_at, status: job.status,
      customer: [job.customer && job.customer.first_name, job.customer && job.customer.last_name].filter(Boolean).join(' '),
      phone: job.customer && job.customer.phone, appliance: job.unit && job.unit.label, problem: job.problem,
      intake: { video: hasVideo, photo: hasPhoto, availability: !!job.availability, waiver: !!job.waiver_signed_at, finished: !!job.intake_done_at },
      media: (media || []).map((m) => ({ kind: m.kind, provider: m.provider })),
      intake_url: token ? `https://tnapplianceexchange.net/i/${token}` : null,
      cockpit: `https://tnapplianceexchange.net/c/${job.id}`,
    } });
  }

  // Stage a new trade (adds a trade_profile row so a shop of that trade can stand up).
  // Harmless infra prep — creates no tenant, sends nothing. ?action=addtrade&trade=aquarium
  if (q.action === 'addtrade') {
    const TRADES = {
      aquarium: {
        trade: 'aquarium', label: 'Aquarium Service', unit_kind: 'tank', unit_label: 'Tank',
        fields: [
          { key: 'gallons', label: 'Gallons', required: false },
          { key: 'water_type', label: 'Water type (fresh / salt / reef)', required: true },
          { key: 'location', label: 'Location', required: false },
          { key: 'livestock', label: 'Livestock', required: false },
        ],
        vocab: { problem_noun: 'issue', service_verb: 'service' },
      },
      furniture: {
        trade: 'furniture', label: 'Furniture', unit_kind: 'order', unit_label: 'Order',
        fields: [
          { key: 'item', label: 'Item', required: true },
          { key: 'custom', label: 'Custom specs', required: false },
          { key: 'finish', label: 'Fabric / finish', required: false },
          { key: 'manufacturer', label: 'Manufacturer', required: false },
          { key: 'eta', label: 'Expected date', required: false },
        ],
        vocab: { problem_noun: 'order', service_verb: 'deliver' },
      },
      dealership: {
        trade: 'dealership', label: 'Auto Sales', unit_kind: 'vehicle', unit_label: 'Vehicle',
        fields: [
          { key: 'interest', label: 'Vehicle of interest', required: true },
          { key: 'trade_in', label: 'Trade-in', required: false },
          { key: 'financing', label: 'Financing needed', required: false },
          { key: 'budget', label: 'Budget', required: false },
          { key: 'stock', label: 'Stock number', required: false },
        ],
        vocab: { problem_noun: 'inquiry', service_verb: 'sell' },
      },
    };
    const t = TRADES[String(q.trade || '').toLowerCase()];
    if (!t) return json(200, { ok: false, error: 'unknown trade; known: ' + Object.keys(TRADES).join(', ') });
    const ex = await rest0(`trade_profile?trade=eq.${t.trade}&select=trade`);
    if (Array.isArray(ex) && ex.length) return json(200, { ok: true, trade: t.trade, note: 'already staged' });
    const ins = await fetch(`${url}/rest/v1/trade_profile`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(t), signal: AbortSignal.timeout(10000) });
    const d = await ins.json().catch(() => ({}));
    return json(200, { ok: ins.ok, status: ins.status, trade: t.trade, staged: ins.ok, error: ins.ok ? undefined : JSON.stringify(d).slice(0, 300) });
  }

  const slug = String(q.slug || '').toLowerCase().trim();
  const name = (q.name || '').trim();
  if (!slug || !name) return json(200, { ok: false, error: 'slug and name required' });
  const trade = (q.trade || 'appliance').trim();
  const email = (q.owner_email || '').trim();
  const plan = (q.plan || 'office').trim();

  // 1) Owner auth login — create it; if the email already exists, find + reuse the uid.
  let uid = null, tempPw = null, userNote = 'no_email';
  if (email) {
    tempPw = tempPassword();
    const cu = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: tempPw, email_confirm: true }), signal: AbortSignal.timeout(10000) });
    const cud = await cu.json().catch(() => ({}));
    if (cu.ok && cud && cud.id) { uid = cud.id; userNote = 'created'; }
    else {
      // already registered (or other) — list and match by email
      const lu = await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers: H, signal: AbortSignal.timeout(10000) });
      const lud = await lu.json().catch(() => ({}));
      const arr = Array.isArray(lud.users) ? lud.users : (Array.isArray(lud) ? lud : []);
      const ex = arr.find((u) => String(u.email || '').toLowerCase() === email.toLowerCase());
      if (ex) { uid = ex.id; userNote = 'existing_user'; tempPw = null; }
      else return json(200, { ok: false, step: 'create_user', status: cu.status, error: JSON.stringify(cud).slice(0, 300) });
    }
  }

  // 2) Company (idempotent by slug).
  let company = null;
  const cg = await rest(`company?slug=eq.${encodeURIComponent(slug)}&select=id,slug,name,trade,plan&limit=1`);
  if (Array.isArray(cg.d) && cg.d[0]) company = cg.d[0];
  if (!company) {
    const settings = { business: { name, phone: (q.owner_phone || '').replace(/[^\d+]/g, ''), area: q.area || '' } };
    const features = { database: true, scheduling: true, portal: true, invoicing: true };
    const ins = await rest('company', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ slug, name, trade, plan, features, settings }) });
    if (!ins.ok) return json(200, { ok: false, step: 'create_company', status: ins.status, error: JSON.stringify(ins.d).slice(0, 300) });
    company = Array.isArray(ins.d) ? ins.d[0] : ins.d;
  }

  // 3) Owner app_user link (idempotent by company + uid).
  let ownerLinked = false;
  if (uid) {
    const au = await rest(`app_user?company_id=eq.${company.id}&auth_user_id=eq.${uid}&select=id&limit=1`);
    if (Array.isArray(au.d) && au.d[0]) ownerLinked = true;
    else {
      const ai = await rest('app_user', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ company_id: company.id, auth_user_id: uid, role: 'owner', name: q.owner_name || '', phone: (q.owner_phone || ''), email }) });
      if (!ai.ok) return json(200, { ok: false, step: 'link_owner', status: ai.status, error: JSON.stringify(ai.d).slice(0, 300), company });
      ownerLinked = true;
    }
  }

  // Optional: seed one sample job so the board demos populated + proves the lead->board
  // chain works for this tenant end-to-end. &seed=1
  let seeded = null;
  if (q.seed === '1') {
    try {
      var sampleWhat = trade === 'automotive' ? 'Alignment + front brakes'
        : trade === 'aquarium' ? 'Reef tank — monthly maintenance'
        : trade === 'furniture' ? 'Custom sectional — special order'
        : trade === 'dealership' ? 'Interested in a cargo van — has a trade-in'
        : 'Sample job';
      seeded = await createLeadJob({
        slug, name: 'Sample Lead (demo)', phone: '+16155551234',
        what: sampleWhat,
        detail: 'This is a sample card so you can see the board. Delete it anytime.',
        city: q.area || '', source: 'provision_seed',
      });
    } catch (e) { seeded = { ok: false, error: String((e && e.message) || e).slice(0, 120) }; }
  }

  return json(200, {
    ok: true,
    seeded,
    company: { id: company.id, slug: company.slug, name: company.name, trade: company.trade, plan: company.plan },
    login: { email, temp_password: tempPw, note: userNote },
    owner_linked: ownerLinked,
    surfaces: {
      office_board: 'https://tnapplianceexchange.net/platform/office-board.html',
      tech_app: 'https://tnapplianceexchange.net/platform/tech.html',
    },
    next: `set platformSlug: '${slug}' on the shop in _lib/trial-shops.js so Ann's leads land on this board`,
  });
};
