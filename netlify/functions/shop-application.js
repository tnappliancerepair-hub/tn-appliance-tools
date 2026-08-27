// shop-application — the CLONE MACHINE intake + approval. A shop owner fills out /apply.html
// (public, no login) → lands as a PENDING application (you get a text). You review it on
// /applications.html and tap Approve → this calls onboard-shop (tenant + login + Ann number +
// assistant, all idempotent) and marks it approved. Decline just flags it. Vetted, one-tap,
// no build per shop.
//
//   POST ?action=submit                       { name, trade, area, hours, about, owner_first,
//                                               owner_name, owner_email, owner_cell, bot_name,
//                                               has_number, number, buy_area, pay_note }
//   GET  ?action=list&secret=<admin>          -> { applications:[...] }
//   POST ?action=approve&id=&secret=<admin>   -> runs onboard-shop; returns login + ann number
//   POST ?action=decline&id=&secret=<admin>
'use strict';

const { getSecret } = require('./_lib/secrets');
let sms = null; try { sms = require('./_lib/sms'); } catch (_) {}
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function e164(p) { const d = String(p || '').replace(/[^\d+]/g, ''); if (d.startsWith('+')) return d; if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; return d; }

async function cfg() {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url: String(url).replace(/\/+$/, ''), key };
}
function rest(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    async get(path) { const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(8000) }); return r.ok ? r.json() : []; },
    async insert(row) { const r = await fetch(`${base}/rest/v1/shop_application`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) }); const d = await r.json().catch(() => null); if (!r.ok) throw new Error((d && d.message) || ('insert ' + r.status)); return Array.isArray(d) ? d[0] : d; },
    async patch(id, row) { const r = await fetch(`${base}/rest/v1/shop_application?id=eq.${id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) }); return r.ok; },
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const p = Object.assign({}, body, q);
  const action = String(q.action || p.action || '').toLowerCase();

  const { url, key } = await cfg();
  if (!url || !key) return json(200, { ok: false, error: 'platform_not_configured' });
  const db = rest(url, key);
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  const isAdmin = (q.secret || p.secret) === guard;

  const SITE = 'https://' + ((event.headers && (event.headers['x-forwarded-host'] || event.headers.host)) || 'tnapplianceexchange.net');

  // ── SUBMIT (public) ─────────────────────────────────────────────────────────
  if (action === 'submit') {
    const name = String(p.name || '').trim();
    const ownerCell = e164(p.owner_cell || '');
    const ownerEmail = String(p.owner_email || '').trim();
    if (!name) return json(200, { ok: false, error: 'Please tell us your business name.' });
    if (!ownerCell) return json(200, { ok: false, error: 'Please add a cell number for your leads.' });
    if (!ownerEmail) return json(200, { ok: false, error: 'Please add an email — that becomes your login.' });
    const row = {
      status: 'pending', name, trade: String(p.trade || 'appliance').toLowerCase().trim(),
      area: String(p.area || '').trim(), hours: String(p.hours || '').trim(), about: String(p.about || '').trim(),
      owner_first: String(p.owner_first || '').trim(), owner_name: String(p.owner_name || '').trim(),
      owner_email: ownerEmail, owner_cell: ownerCell, bot_name: String(p.bot_name || 'Ant').trim(),
      has_number: !!(p.has_number === true || p.has_number === 'true' || p.number),
      number: e164(p.number || '') || null, buy_area: String(p.buy_area || '').replace(/\D/g, '') || null,
      pay_note: String(p.pay_note || '').trim() || null,
    };
    let app;
    try { app = await db.insert(row); } catch (e) { return json(200, { ok: false, error: 'Could not submit — try again.' }); }
    // ping the platform owner so they can vet + approve
    try {
      const adminCell = (await getSecret('PLATFORM_ADMIN_CELL')) || '+16154855795';
      if (sms) await sms.sendSms(adminCell, `🐜 New Ant application: ${name} (${row.trade}) — ${row.area || 'area n/a'}. Review + approve: ${SITE}/applications.html`, 'office', 'shop_application');
    } catch (_) {}
    return json(200, { ok: true, id: app && app.id });
  }

  // everything below is admin-only
  if (!isAdmin) return json(403, { ok: false, error: 'forbidden' });

  // ── LIST ────────────────────────────────────────────────────────────────────
  if (action === 'list') {
    const rows = await db.get('shop_application?select=*&order=created_at.desc&limit=200');
    return json(200, { ok: true, applications: Array.isArray(rows) ? rows : [] });
  }

  // ── APPROVE → run onboard-shop ──────────────────────────────────────────────
  if (action === 'approve') {
    const id = String(p.id || '').trim();
    if (!id) return json(200, { ok: false, error: 'id required' });
    const rows = await db.get(`shop_application?id=eq.${id}&select=*&limit=1`);
    const a = rows && rows[0];
    if (!a) return json(200, { ok: false, error: 'application not found' });

    const params = new URLSearchParams({
      secret: guard, action: 'onboard', name: a.name || '', type: a.trade || 'appliance',
      area: a.area || '', about: a.about || '', hours: a.hours || '',
      owner_first: a.owner_first || '', owner_name: a.owner_name || a.owner_first || '',
      owner_email: a.owner_email || '', owner_cell: a.owner_cell || '',
    });
    if (a.number) params.set('number', a.number);          // they brought a line
    else if (a.buy_area) params.set('buy_area', a.buy_area); // buy one on the fly
    let ob = {};
    try {
      const r = await fetch(`${SITE}/.netlify/functions/onboard-shop?` + params.toString(), { signal: AbortSignal.timeout(45000) });
      ob = await r.json().catch(() => ({}));
    } catch (e) { return json(200, { ok: false, error: 'onboard failed: ' + String((e && e.message) || e) }); }
    if (!ob || ob.ok === false) return json(200, { ok: false, error: (ob && ob.error) || 'onboard failed', detail: ob });

    await db.patch(id, { status: 'approved', slug: ob.slug || null, ann_number: ob.ann_number || null, reviewed_at: new Date().toISOString() });
    // text the new owner their login + number (best-effort)
    try {
      if (sms && a.owner_cell && ob.owner_login) {
        const link = `${SITE}/platform/office-board.html`;
        await sms.sendSms(a.owner_cell, `Welcome to Ant, ${a.owner_first || a.name}! Your board: ${link}\nLogin: ${ob.owner_login.email}\nTemp password: ${ob.owner_login.temp_password}${ob.ann_number ? `\nYour Ann line: ${ob.ann_number}` : ''}`, 'office', 'shop_approved');
      }
    } catch (_) {}
    return json(200, { ok: true, ready: ob.ready, slug: ob.slug, ann_number: ob.ann_number, owner_login: ob.owner_login, steps: ob.steps });
  }

  // ── DECLINE ─────────────────────────────────────────────────────────────────
  if (action === 'decline') {
    const id = String(p.id || '').trim();
    if (!id) return json(200, { ok: false, error: 'id required' });
    await db.patch(id, { status: 'declined', reviewed_at: new Date().toISOString() });
    return json(200, { ok: true });
  }

  return json(200, { ok: false, error: 'unknown action' });
};
