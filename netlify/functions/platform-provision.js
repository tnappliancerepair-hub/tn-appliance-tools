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

  return json(200, {
    ok: true,
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
