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
const { getSecret, setSecret } = require('./_lib/secrets');
const { createLeadJob } = require('./_lib/platform-db');
const { shopHandle } = require('./_lib/shop-handle');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function tempPassword() { return 'Ant-' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89); }

// A valid Supabase operator login (Authorization: Bearer <jwt>) opens the operator tools
// without the admin key — same one-tap session the shop apps use.
const OPERATOR_EMAILS = ['tnappliancerepair@gmail.com'];
const PLATFORM_ANON = 'sb_publishable_gtcSGgZWhqkrUxdPxFhKrA_CwUBcyq7';
async function operatorFromJWT(event) {
  const h = event.headers || {};
  const m = String(h.authorization || h.Authorization || '').match(/Bearer\s+(.+)/i);
  if (!m) return null;
  const base = (await getSecret('PLATFORM_SUPABASE_URL')) || 'https://tntbhfwitytkcoqlejwc.supabase.co';
  try {
    const r = await fetch(`${base}/auth/v1/user`, { headers: { Authorization: 'Bearer ' + m[1], apikey: PLATFORM_ANON }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const u = await r.json().catch(() => null);
    const email = String((u && u.email) || '').toLowerCase();
    return OPERATOR_EMAILS.includes(email) ? email : null;
  } catch (_) { return null; }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const isAdmin = q.secret === guard || !!(await operatorFromJWT(event));
  // addtech + settech_active are ALSO owner-self-serve (scoped to their own company via their
  // session token); every other action stays admin/operator-only.
  const OWNER_OK = { addtech: 1, settech_active: 1 };
  if (!isAdmin && !OWNER_OK[q.action]) return { statusCode: 403, body: 'forbidden' };

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

  // Reset an owner's platform login password to a fresh one and DROP IT IN THE VAULT
  // server-side (the value never returns through chat/logs). The owner then reads it at
  // admin-secrets.html and signs into /platform/office-board.html, changing it on first
  // login. ?action=resetpw&slug=tn-appliance   (or &email=owner@...)
  if (q.action === 'resetpw') {
    const slug = String(q.slug || '').toLowerCase().trim();
    let ownerEmail = String(q.email || '').toLowerCase().trim();
    if (!ownerEmail && slug) {
      const cos = await rest0(`company?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`);
      const co = cos && cos[0];
      if (!co) return json(200, { ok: false, error: 'unknown slug: ' + slug });
      const us = await rest0(`app_user?company_id=eq.${co.id}&role=eq.owner&select=email&order=created_at.asc&limit=1`);
      ownerEmail = us && us[0] && String(us[0].email || '').toLowerCase();
    }
    if (!ownerEmail) return json(200, { ok: false, error: 'no owner email (pass &slug= or &email=)' });
    // find the Supabase auth user for that email
    const listR = await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers: H, signal: AbortSignal.timeout(12000) });
    const list = await listR.json().catch(() => ({}));
    const users = (list && (list.users || list)) || [];
    const u = Array.isArray(users) ? users.find((x) => String(x.email || '').toLowerCase() === ownerEmail) : null;
    if (!u) return json(200, { ok: false, error: 'auth user not found for ' + ownerEmail });
    const newpw = tempPassword();
    const setR = await fetch(`${url}/auth/v1/admin/users/${u.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ password: newpw }), signal: AbortSignal.timeout(12000) });
    if (!setR.ok) { const e = await setR.text().catch(() => ''); return json(200, { ok: false, error: 'password set failed ' + setR.status + ' ' + e.slice(0, 120) }); }
    const vaultKey = 'PLATFORM_OWNER_PW_' + (slug || 'tn').toUpperCase().replace(/[^A-Z0-9]/g, '_');
    let saved = false; try { saved = await setSecret(vaultKey, newpw); } catch (_) { saved = false; }
    return json(200, { ok: true, owner_email: ownerEmail, vault_key: vaultKey, saved, login_url: 'https://tnapplianceexchange.net/platform/office-board.html', note: 'read the password from admin-secrets.html under vault_key, then change it on first login' });
  }

  // One-tap login link (no password in chat). Uses the Admin generate_link endpoint to
  // return a magic-login URL for an existing owner/staff email. Tapping it signs the person
  // in on this origin; that Supabase session then covers ALL platform apps (office board,
  // tech, owner) since they share the same origin+client. For letting Teddy SEE the apps.
  //   ?action=magiclink&slug=tn-appliance         (owner login of that shop)
  //   ?action=magiclink&email=someone@shop.com     (a specific login)
  //   optional &redirect=<full url> (default: office board)
  if (q.action === 'magiclink') {
    let email = String(q.email || '').toLowerCase().trim();
    const slug = String(q.slug || '').toLowerCase().trim();
    if (!email && slug) {
      const cos = await rest0(`company?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`);
      const co = cos && cos[0];
      if (!co) return json(200, { ok: false, error: 'unknown slug: ' + slug });
      const us = await rest0(`app_user?company_id=eq.${co.id}&role=eq.owner&select=email&order=created_at.asc&limit=1`);
      email = us && us[0] && String(us[0].email || '').toLowerCase();
    }
    if (!email) return json(200, { ok: false, error: 'need &email= or &slug=' });
    const redirect = String(q.redirect || 'https://tnapplianceexchange.net/platform/office-board.html');
    const r = await fetch(`${url}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email, redirect_to: redirect }), signal: AbortSignal.timeout(12000) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return json(200, { ok: false, error: 'generate_link ' + r.status + ' ' + JSON.stringify(d).slice(0, 200) });
    const link = d.action_link || (d.properties && d.properties.action_link) || '';
    return json(200, { ok: true, email, login_link: link, redirect, note: 'one tap logs in; the session then covers office board + tech + owner apps on this origin' });
  }

  // Mint (or reuse) a customer portal link for a shop's job — the CUSTOMER lens, token-gated,
  // no login. ?action=portaltoken&slug=tn-appliance[&job_id=<uuid>]  (defaults to newest job)
  if (q.action === 'portaltoken') {
    const slug = String(q.slug || 'tn-appliance').toLowerCase().trim();
    const cos = await rest0(`company?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`);
    const co = cos && cos[0];
    if (!co) return json(200, { ok: false, error: 'unknown slug: ' + slug });
    let job = null;
    if (q.job_id) { const js = await rest0(`job?id=eq.${encodeURIComponent(q.job_id)}&select=id,customer_id&limit=1`); job = js && js[0]; }
    if (!job) { const js = await rest0(`job?company_id=eq.${co.id}&customer_id=not.is.null&order=created_at.desc&limit=1&select=id,customer_id`); job = js && js[0]; }
    if (!job || !job.customer_id) return json(200, { ok: false, error: 'no job with a customer found' });
    const existing = await rest0(`portal_grant?job_id=eq.${job.id}&revoked=eq.false&order=created_at.desc&limit=1&select=token`);
    let token = existing && existing[0] && existing[0].token;
    if (!token) {
      const ins = await rest('portal_grant', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ company_id: co.id, customer_id: job.customer_id, job_id: job.id, expires_at: new Date(Date.now() + 60 * 86400000).toISOString() }) });
      if (!ins.ok) return json(200, { ok: false, error: 'grant insert ' + ins.status + ' ' + JSON.stringify(ins.d).slice(0, 160) });
      token = (Array.isArray(ins.d) ? ins.d[0] : ins.d) && (Array.isArray(ins.d) ? ins.d[0].token : ins.d.token);
    }
    return json(200, { ok: true, job_id: job.id, portal_url: 'https://tnapplianceexchange.net/platform/portal.html?t=' + token });
  }

  // Offboard a client that LEAVES — soft + reversible: mark the company churned, stamp when
  // + why, and revoke every login for it (ban the auth users) so nobody can sign in. ALL of
  // the shop's data is KEPT (retention) — deletion is a separate, deliberate purge later.
  //   ?action=offboard&slug=<slug>&reason=<text>
  if (q.action === 'offboard') {
    const slug = String(q.slug || '').toLowerCase().trim();
    if (!slug) return json(200, { ok: false, error: 'slug required' });
    if (slug === 'tn-appliance') return json(200, { ok: false, error: 'refusing to offboard the flagship (tn-appliance)' });
    const cos = await rest0(`company?slug=eq.${encodeURIComponent(slug)}&select=id,name,status`);
    const co = cos && cos[0];
    if (!co) return json(200, { ok: false, error: 'unknown slug: ' + slug });
    const patch = await rest(`company?id=eq.${co.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'churned', churned_at: new Date().toISOString(), churn_reason: String(q.reason || '').slice(0, 300) || null }) });
    if (!patch.ok) return json(200, { ok: false, error: 'status update ' + patch.status });
    // revoke logins (best-effort)
    const users = await rest0(`app_user?company_id=eq.${co.id}&select=auth_user_id`);
    let revoked = 0;
    for (const u of (Array.isArray(users) ? users : [])) {
      if (!u.auth_user_id) continue;
      try { const r = await fetch(`${url}/auth/v1/admin/users/${u.auth_user_id}`, { method: 'PUT', headers: H, body: JSON.stringify({ ban_duration: '876000h' }), signal: AbortSignal.timeout(8000) }); if (r.ok) revoked++; } catch (_) {}
    }
    return json(200, { ok: true, slug, name: co.name, status: 'churned', logins_revoked: revoked, note: 'data retained; run a purge later to delete it' });
  }

  // Reactivate a client that came back (or was offboarded by mistake): clear churn + un-ban.
  //   ?action=reactivate&slug=<slug>[&status=active|trial]
  if (q.action === 'reactivate') {
    const slug = String(q.slug || '').toLowerCase().trim();
    if (!slug) return json(200, { ok: false, error: 'slug required' });
    const cos = await rest0(`company?slug=eq.${encodeURIComponent(slug)}&select=id,name`);
    const co = cos && cos[0];
    if (!co) return json(200, { ok: false, error: 'unknown slug: ' + slug });
    const newStatus = ['active', 'trial', 'paused'].includes(String(q.status || '').toLowerCase()) ? String(q.status).toLowerCase() : 'active';
    const patch = await rest(`company?id=eq.${co.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: newStatus, churned_at: null, churn_reason: null }) });
    if (!patch.ok) return json(200, { ok: false, error: 'status update ' + patch.status });
    const users = await rest0(`app_user?company_id=eq.${co.id}&select=auth_user_id`);
    let restored = 0;
    for (const u of (Array.isArray(users) ? users : [])) {
      if (!u.auth_user_id) continue;
      try { const r = await fetch(`${url}/auth/v1/admin/users/${u.auth_user_id}`, { method: 'PUT', headers: H, body: JSON.stringify({ ban_duration: 'none' }), signal: AbortSignal.timeout(8000) }); if (r.ok) restored++; } catch (_) {}
    }
    return json(200, { ok: true, slug, name: co.name, status: newStatus, logins_restored: restored });
  }

  // PURGE — permanently delete a churned client's data after the retention window. Hard,
  // irreversible. Guards: must be churned; must be past 30-day retention (unless &force=yes);
  // never the flagship; requires &confirm=yes. Deletes every tenant-scoped row + the logins.
  //   ?action=purge&slug=<slug>&confirm=yes[&force=yes]
  if (q.action === 'purge') {
    const RETENTION_DAYS = 30; // Teddy 2026-08-28: keep 30 days after a client leaves, then purge.
    const slug = String(q.slug || '').toLowerCase().trim();
    if (!slug) return json(200, { ok: false, error: 'slug required' });
    if (slug === 'tn-appliance') return json(200, { ok: false, error: 'refusing to purge the flagship' });
    const cos = await rest0(`company?slug=eq.${encodeURIComponent(slug)}&select=id,name,status,churned_at`);
    const co = cos && cos[0];
    if (!co) return json(200, { ok: false, error: 'unknown slug: ' + slug });
    if (co.status !== 'churned') return json(200, { ok: false, error: 'not churned — offboard the client first (status=' + co.status + ')' });
    const force = q.force === 'yes';
    const daysSinceChurn = co.churned_at ? (Date.now() - Date.parse(co.churned_at)) / 86400000 : 0;
    if (!force && daysSinceChurn < RETENTION_DAYS) {
      return json(200, { ok: false, error: 'within retention', purge_in_days: Math.ceil(RETENTION_DAYS - daysSinceChurn), note: 'still in the ' + RETENTION_DAYS + '-day window; pass &force=yes only for a deliberate early delete' });
    }
    if (q.confirm !== 'yes') return json(200, { ok: false, error: 'purge requires &confirm=yes', would_delete: co.name });
    // delete the auth logins first (need their ids from app_user)
    const users = await rest0(`app_user?company_id=eq.${co.id}&select=auth_user_id`);
    let authDeleted = 0;
    for (const u of (Array.isArray(users) ? users : [])) {
      if (!u.auth_user_id) continue;
      try { const r = await fetch(`${url}/auth/v1/admin/users/${u.auth_user_id}`, { method: 'DELETE', headers: H, signal: AbortSignal.timeout(8000) }); if (r.ok) authDeleted++; } catch (_) {}
    }
    // atomic cascade delete of every tenant-scoped row, children first
    const mgmtToken = await getSecret('SUPABASE_MGMT_TOKEN');
    const ref = ((url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i) || [])[1]) || 'tntbhfwitytkcoqlejwc';
    if (!mgmtToken) return json(200, { ok: false, error: 'auth logins deleted but SUPABASE_MGMT_TOKEN missing — data not purged', auth_deleted: authDeleted });
    const cid = co.id;
    const sql = `do $$ declare cid uuid := '${cid}';
      begin
        delete from invoice_line where company_id=cid;
        delete from invoice where company_id=cid;
        delete from thread_message where company_id=cid;
        delete from portal_grant where company_id=cid;
        delete from job_media where company_id=cid;
        delete from job_tdr where company_id=cid;
        delete from event where company_id=cid;
        delete from shop_application where company_id=cid;
        delete from job where company_id=cid;
        delete from unit where company_id=cid;
        delete from technician where company_id=cid;
        delete from customer where company_id=cid;
        delete from app_user where company_id=cid;
        delete from company where id=cid;
      end $$;`;
    try {
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: 'Bearer ' + mgmtToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(20000) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return json(200, { ok: false, error: 'purge sql ' + r.status + ' ' + JSON.stringify(d).slice(0, 200), auth_deleted: authDeleted });
    } catch (e) { return json(200, { ok: false, error: 'purge sql ' + String((e && e.message) || e).slice(0, 160), auth_deleted: authDeleted }); }
    return json(200, { ok: true, purged: co.name, slug, auth_deleted: authDeleted, note: 'all data permanently deleted' });
  }

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

  // Onboard a TECHNICIAN with a working login — the missing piece so a new tenant's crew can
  // actually sign into the tech app. Creates (or reuses) the tech's Supabase auth login, an
  // app_user row (role=tech), and links a technician row to it. Idempotent, and it ADOPTS an
  // existing seeded technician of the same name that has no login yet (so an owner who typed
  // their roster in first doesn't get duplicates). The temp password drops in the vault.
  //   ?action=addtech&secret=<admin>&slug=<shop>&tech_email=<email>&tech_name=<name>
  //     [&tech_phone=+1…][&commission_pct=50]
  if (q.action === 'addtech') {
    let ab = {}; try { ab = JSON.parse(event.body || '{}'); } catch (_) {}
    const techEmail = String(q.tech_email || ab.tech_email || '').toLowerCase().trim();
    const techName = String(q.tech_name || ab.tech_name || '').trim();
    if (!techEmail || !techName) return json(200, { ok: false, error: 'tech_email and tech_name required' });
    // Resolve which company: admin/operator picks by &slug=; an owner is locked to their own
    // company, derived from their session token (they can never add crew to another shop).
    let co = null, viaOwner = false;
    if (isAdmin) {
      const slug0 = String(q.slug || ab.slug || '').toLowerCase().trim();
      if (!slug0) return json(200, { ok: false, error: 'slug required' });
      const cos = await rest0(`company?slug=eq.${encodeURIComponent(slug0)}&select=id,name,slug&limit=1`);
      co = cos && cos[0];
      if (!co) return json(200, { ok: false, error: 'unknown slug: ' + slug0 });
    } else {
      const tok = String(ab.access_token || q.access_token || '');
      try {
        const ur = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: 'Bearer ' + tok, apikey: PLATFORM_ANON }, signal: AbortSignal.timeout(8000) });
        if (ur.ok) { const uu = await ur.json().catch(() => null);
          if (uu && uu.id) { const rows = await rest0(`app_user?auth_user_id=eq.${encodeURIComponent(uu.id)}&role=eq.owner&select=company_id&limit=1`);
            const cid = rows && rows[0] && rows[0].company_id;
            if (cid) { const cos = await rest0(`company?id=eq.${cid}&select=id,name,slug&limit=1`); co = cos && cos[0]; viaOwner = true; } } }
      } catch (_) {}
      if (!co) return json(200, { ok: false, error: 'sign in as the shop owner to add crew' });
    }
    const slug = co.slug;

    // 1) auth login — create; if the email already exists, find + reuse the uid.
    let uid = null, tempPw = tempPassword(), userNote = 'created';
    const cu = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email: techEmail, password: tempPw, email_confirm: true }), signal: AbortSignal.timeout(10000) });
    const cud = await cu.json().catch(() => ({}));
    if (cu.ok && cud && cud.id) { uid = cud.id; }
    else {
      const lu = await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers: H, signal: AbortSignal.timeout(10000) });
      const lud = await lu.json().catch(() => ({}));
      const arr = Array.isArray(lud.users) ? lud.users : (Array.isArray(lud) ? lud : []);
      const ex = arr.find((u) => String(u.email || '').toLowerCase() === techEmail);
      if (ex) { uid = ex.id; userNote = 'existing_user'; tempPw = null; }
      else return json(200, { ok: false, step: 'create_user', status: cu.status, error: JSON.stringify(cud).slice(0, 300) });
    }

    // 2) app_user (role=tech), idempotent by company + uid.
    let appUserId = null;
    const auEx = await rest(`app_user?company_id=eq.${co.id}&auth_user_id=eq.${uid}&select=id,role&limit=1`);
    if (Array.isArray(auEx.d) && auEx.d[0]) appUserId = auEx.d[0].id;
    else {
      const ai = await rest('app_user', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ company_id: co.id, auth_user_id: uid, role: 'tech', name: techName, phone: (q.tech_phone || ''), email: techEmail }) });
      if (!ai.ok) return json(200, { ok: false, step: 'link_app_user', status: ai.status, error: JSON.stringify(ai.d).slice(0, 300) });
      appUserId = (Array.isArray(ai.d) ? ai.d[0] : ai.d).id;
    }

    // 3) technician row — reuse one already linked to this login; else ADOPT a same-name
    //    technician with no login yet; else create a fresh one.
    const pct = q.commission_pct != null && q.commission_pct !== '' ? Number(q.commission_pct) : 50;
    let techRow = null, techNote = '';
    const linked = await rest(`technician?company_id=eq.${co.id}&app_user_id=eq.${appUserId}&select=id,name&limit=1`);
    if (Array.isArray(linked.d) && linked.d[0]) { techRow = linked.d[0]; techNote = 'already_linked'; }
    if (!techRow) {
      const orphan = await rest(`technician?company_id=eq.${co.id}&app_user_id=is.null&name=eq.${encodeURIComponent(techName)}&select=id,name&limit=1`);
      if (Array.isArray(orphan.d) && orphan.d[0]) {
        const patch = await rest(`technician?id=eq.${orphan.d[0].id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ app_user_id: appUserId, active: true }) });
        if (!patch.ok) return json(200, { ok: false, step: 'adopt_technician', status: patch.status, error: JSON.stringify(patch.d).slice(0, 300) });
        techRow = Array.isArray(patch.d) ? patch.d[0] : patch.d; techNote = 'adopted_existing';
      }
    }
    if (!techRow) {
      const ti = await rest('technician', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ company_id: co.id, app_user_id: appUserId, name: techName, active: true, commission_type: 'pct', commission_pct: pct }) });
      if (!ti.ok) return json(200, { ok: false, step: 'create_technician', status: ti.status, error: JSON.stringify(ti.d).slice(0, 300) });
      techRow = Array.isArray(ti.d) ? ti.d[0] : ti.d; techNote = 'created';
    }

    // Admin path: drop the temp password in the vault (never returned through chat/logs).
    // Owner path: hand the password straight back so the owner can give it to their tech.
    let vaultKey = null, saved = false;
    if (tempPw && !viaOwner) {
      vaultKey = 'PLATFORM_TECH_PW_' + slug.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_' + techName.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 20);
      try { saved = await setSecret(vaultKey, tempPw); } catch (_) { saved = false; }
    }
    const givePw = tempPw && (viaOwner || !saved);   // return the pw when the owner needs it, or vaulting failed
    return json(200, {
      ok: true, slug, shop: co.name, tech: { id: techRow.id, name: techName, email: techEmail },
      login: { email: techEmail, note: userNote, temp_password: givePw ? tempPw : undefined, vault_key: vaultKey || undefined, saved: vaultKey ? saved : undefined },
      technician: techNote, app_user_id: appUserId,
      login_url: 'https://tnapplianceexchange.net/platform/tech.html',
      note: (userNote === 'existing_user'
        ? 'Reused an existing login (no new password).'
        : (viaOwner ? 'Give your tech this email + temporary password — they sign in and change it.' : 'Read the password from admin-secrets.html under vault_key.'))
        + ' The tech signs into the tech app and sees only their own jobs and pay.',
    });
  }

  // Deactivate (or restore) a crew member — the owner "remove" that pairs with addtech. Keeps
  // ALL of the tech's history (jobs, pay, leaderboard); just flips technician.active and
  // bans/unbans their login so a removed tech can't sign in. Reversible. Owner-scoped (their
  // own company only) or admin by &slug=.
  //   POST { access_token, tech_id, active:false }   (or true to restore)
  if (q.action === 'settech_active') {
    let ab = {}; try { ab = JSON.parse(event.body || '{}'); } catch (_) {}
    const techId = String(q.tech_id || ab.tech_id || '').trim();
    const rawA = (ab.active != null ? ab.active : q.active);
    const active = (rawA === true || rawA === 'true' || rawA === '1') ? true
      : (rawA === false || rawA === 'false' || rawA === '0') ? false : null;
    if (!techId || active === null) return json(200, { ok: false, error: 'tech_id and active (true|false) required' });
    let co = null;
    if (isAdmin) {
      const slug0 = String(q.slug || ab.slug || '').toLowerCase().trim();
      if (!slug0) return json(200, { ok: false, error: 'slug required' });
      const cos = await rest0(`company?slug=eq.${encodeURIComponent(slug0)}&select=id&limit=1`);
      co = cos && cos[0];
    } else {
      const tok = String(ab.access_token || q.access_token || '');
      try {
        const ur = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: 'Bearer ' + tok, apikey: PLATFORM_ANON }, signal: AbortSignal.timeout(8000) });
        if (ur.ok) { const uu = await ur.json().catch(() => null);
          if (uu && uu.id) { const rows = await rest0(`app_user?auth_user_id=eq.${encodeURIComponent(uu.id)}&role=eq.owner&select=company_id&limit=1`);
            const cid = rows && rows[0] && rows[0].company_id;
            if (cid) { const cos = await rest0(`company?id=eq.${cid}&select=id&limit=1`); co = cos && cos[0]; } } }
      } catch (_) {}
      if (!co) return json(200, { ok: false, error: 'sign in as the shop owner' });
    }
    if (!co) return json(200, { ok: false, error: 'unknown company' });
    // the technician must belong to this company
    const techs = await rest0(`technician?id=eq.${encodeURIComponent(techId)}&company_id=eq.${co.id}&select=id,name,app_user_id&limit=1`);
    const t = techs && techs[0];
    if (!t) return json(200, { ok: false, error: 'not your technician' });
    const patch = await rest(`technician?id=eq.${t.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active }) });
    if (!patch.ok) return json(200, { ok: false, error: 'update ' + patch.status });
    // ban / unban the login so a removed tech can't sign in (best-effort; history is kept)
    let auth = 'no_login';
    if (t.app_user_id) {
      const au = await rest0(`app_user?id=eq.${t.app_user_id}&select=auth_user_id&limit=1`);
      const uid = au && au[0] && au[0].auth_user_id;
      if (uid) { try { const r = await fetch(`${url}/auth/v1/admin/users/${uid}`, { method: 'PUT', headers: H, body: JSON.stringify({ ban_duration: active ? 'none' : '876000h' }), signal: AbortSignal.timeout(8000) }); auth = r.ok ? (active ? 'unbanned' : 'banned') : ('ban_' + r.status); } catch (_) { auth = 'ban_error'; } }
    }
    return json(200, { ok: true, tech: { id: t.id, name: t.name, active }, auth });
  }

  const slug = String(q.slug || '').toLowerCase().trim();
  const name = (q.name || '').trim();
  if (!slug || !name) return json(200, { ok: false, error: 'slug and name required' });
  const trade = (q.trade || 'appliance').trim();
  // Short subdomain handle: "appliance"/"repair" are already in applianceant.com, so the
  // shop's subdomain is just their name — "Joey's Appliance Repair" -> joeys.applianceant.com.
  // Owner can override with &subdomain=. Stored on settings.site.subdomain; platform-site
  // resolves a subdomain hit by handle OR full slug.
  const subdomain = String(q.subdomain || shopHandle(name)).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 40);
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
    const settings = { business: { name, phone: (q.owner_phone || '').replace(/[^\d+]/g, ''), area: q.area || '' }, site: { subdomain } };
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
