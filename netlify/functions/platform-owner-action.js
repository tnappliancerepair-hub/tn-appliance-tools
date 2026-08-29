// platform-owner-action — the reversible action ledger engine (the spine of the Ant partner).
//
// Every change the owner or CSR (or Ant on their behalf) makes routes through ONE path here:
// it captures the BEFORE value, applies the change, and writes an `owner_action` row with
// before -> after. Because every row carries the exact before-state, EVERY action can be undone.
// Ant never writes raw data — it only calls these whitelisted intents, which map 1:1 to the
// same controls the owner already has in the UI. That is what makes "act AND reverse" safe.
//
// Auth: the caller's Supabase session (verified server-side). We resolve the caller's company +
// role and gate every action to owner/office/manager/admin. Writes use the platform service key
// but are ALWAYS scoped by the resolved company_id in code — a caller can never touch another shop.
//
//   POST ?do=apply  { access_token, intent, args, via?, reason? }  -> { ok, action_id, label, before, after }
//   POST ?do=undo   { access_token, action_id }                    -> { ok, action_id, label }
//   POST ?do=list   { access_token, limit? }                       -> { ok, actions:[...] }
//   POST ?do=intents { access_token }                              -> { ok, intents:[...] }   (what Ant may call)
'use strict';

const { getSecret } = require('./_lib/secrets');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

async function cfg() {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { base: String(url).replace(/\/+$/, ''), key };
}

// ---- tiny PostgREST client on the service key (RLS bypassed; we scope by company in code) ----
function db(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    async get(path) { const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error('get ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120)); return r.json(); },
    async patch(path, body) { const r = await fetch(`${base}/rest/v1/${path}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error('patch ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120)); const d = await r.json().catch(() => []); return Array.isArray(d) ? d[0] : d; },
    async insert(table, row) { const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error('insert ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120)); const d = await r.json().catch(() => []); return Array.isArray(d) ? d[0] : d; },
    async del(path) { const r = await fetch(`${base}/rest/v1/${path}`, { method: 'DELETE', headers: H, signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error('del ' + r.status); return true; },
  };
}

async function authUser(base, key, token) {
  if (!token) return null;
  try { const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000) }); if (!r.ok) return null; const u = await r.json(); return (u && u.id) ? u : null; } catch (_) { return null; }
}

// ---- helpers for nested settings paths ----
function getPath(obj, keys) { let o = obj; for (const k of keys) { if (o == null || typeof o !== 'object') return undefined; o = o[k]; } return o; }
function setPath(obj, keys, value) {
  const root = obj && typeof obj === 'object' ? JSON.parse(JSON.stringify(obj)) : {};
  let o = root;
  for (let i = 0; i < keys.length - 1; i++) { const k = keys[i]; if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
  if (value === undefined) { delete o[keys[keys.length - 1]]; } else { o[keys[keys.length - 1]] = value; }
  return root;
}
const centsMoney = (c) => '$' + (Math.round(Number(c || 0)) / 100).toLocaleString('en-US', { minimumFractionDigits: 0 });
const commsLabel = { reminder: 'day-before reminder', otw: 'on-my-way text', arrived: 'arrived text', complete: 'job-done text', review: 'review request', offer: 'schedule offer', assigned: 'tech-assigned text' };

// A "target" describes what a settings-path change touched, so undo can reverse it generically.
async function applyCompanySettingsPath(ctx, keys, newVal) {
  const rows = await ctx.d.get(`company?id=eq.${ctx.companyId}&select=settings`);
  const settings = (rows && rows[0] && rows[0].settings) || {};
  const before = getPath(settings, keys);
  const next = setPath(settings, keys, newVal);
  await ctx.d.patch(`company?id=eq.${ctx.companyId}`, { settings: next });
  return { target_table: 'company', target_id: null, path: 'settings.' + keys.join('.'), op: 'update', before: before === undefined ? null : before, after: newVal === undefined ? null : newVal };
}
async function applyTechField(ctx, techId, fields) {
  const rows = await ctx.d.get(`technician?id=eq.${techId}&company_id=eq.${ctx.companyId}&select=${Object.keys(fields).join(',')}`);
  if (!rows || !rows[0]) throw new Error('tech not found in this shop');
  const before = {}; Object.keys(fields).forEach((k) => { before[k] = rows[0][k]; });
  await ctx.d.patch(`technician?id=eq.${techId}&company_id=eq.${ctx.companyId}`, fields);
  return { target_table: 'technician', target_id: techId, path: null, op: 'update', before, after: fields };
}

// ---- intent registry: each maps 1:1 to a control the owner already has ----
const INTENTS = {
  set_parts_margin: {
    desc: 'Set the parts markup % (and optional minimum add).',
    apply: async (ctx, a) => {
      const pct = Math.max(0, Math.min(300, Math.round(Number(a.markup_pct))));
      if (!isFinite(pct)) throw new Error('markup_pct required');
      const cur = getPath((await ctx.d.get(`company?id=eq.${ctx.companyId}&select=settings`))[0]?.settings || {}, ['parts']) || {};
      const val = { markup_pct: pct, min_add_cents: a.min_add_cents != null ? Math.max(0, Math.round(Number(a.min_add_cents))) : (cur.min_add_cents || 0) };
      const t = await applyCompanySettingsPath(ctx, ['parts'], val);
      const wasPct = (t.before && t.before.markup_pct);
      return { ...t, label: `Set parts margin to ${pct}%` + (wasPct != null ? ` (was ${wasPct}%)` : '') };
    },
  },
  toggle_comms: {
    desc: 'Turn an automated customer text on or off (reminder, otw, arrived, complete, review, offer, assigned).',
    apply: async (ctx, a) => {
      const key = String(a.key || '').trim(); const on = !!a.on;
      if (!commsLabel[key]) throw new Error('unknown comms key');
      const t = await applyCompanySettingsPath(ctx, ['comms', key, 'on'], on);
      return { ...t, label: `Turned ${on ? 'ON' : 'OFF'} the ${commsLabel[key]}` };
    },
  },
  set_comms_text: {
    desc: 'Reword an automated customer text.',
    apply: async (ctx, a) => {
      const key = String(a.key || '').trim(); const text = String(a.text || '');
      if (!commsLabel[key]) throw new Error('unknown comms key');
      const t = await applyCompanySettingsPath(ctx, ['comms', key, 'text'], text);
      return { ...t, label: `Reworded the ${commsLabel[key]}` };
    },
  },
  set_goal: {
    desc: 'Set an owner goal (take_home cents, or rating).',
    apply: async (ctx, a) => {
      const kind = String(a.kind || '').trim();
      if (kind !== 'take_home' && kind !== 'rating') throw new Error('kind must be take_home or rating');
      const val = kind === 'take_home' ? Math.max(0, Math.round(Number(a.value))) : Math.max(0, Math.min(5, Number(a.value)));
      const t = await applyCompanySettingsPath(ctx, ['goals', kind], val);
      const lbl = kind === 'take_home' ? `Set take-home goal to ${centsMoney(val)}` : `Set rating goal to ${val.toFixed(1)}★`;
      return { ...t, label: lbl };
    },
  },
  set_tech_commission: {
    desc: 'Set a tech\'s commission % of labor.',
    apply: async (ctx, a) => {
      const pct = Math.max(0, Math.min(100, Number(a.pct)));
      const t = await applyTechField(ctx, a.technician_id, { commission_pct: pct, commission_type: 'percent' });
      return { ...t, label: `Set ${a.tech_name || 'tech'} commission to ${pct}%` + (t.before.commission_pct != null ? ` (was ${t.before.commission_pct}%)` : '') };
    },
  },
  set_tech_stops: {
    desc: 'Set a tech\'s max stops per day.',
    apply: async (ctx, a) => {
      const n = Math.max(1, Math.min(20, Math.round(Number(a.max_stops))));
      const t = await applyTechField(ctx, a.technician_id, { max_stops: n });
      return { ...t, label: `Set ${a.tech_name || 'tech'} to ${n} stops/day` };
    },
  },
  set_tech_area: {
    desc: 'Set a tech\'s service area (comma ZIPs/prefixes; empty = covers everywhere).',
    apply: async (ctx, a) => {
      const area = String(a.service_area || '').trim();
      const t = await applyTechField(ctx, a.technician_id, { service_area: area });
      return { ...t, label: `Set ${a.tech_name || 'tech'} service area to ${area || 'everywhere'}` };
    },
  },
  add_tech_dayoff: {
    desc: 'Give a tech a day off (PTO).',
    apply: async (ctx, a) => {
      const day = String(a.day || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('day must be YYYY-MM-DD');
      // verify tech is in this shop
      const tk = await ctx.d.get(`technician?id=eq.${a.technician_id}&company_id=eq.${ctx.companyId}&select=id`);
      if (!tk || !tk[0]) throw new Error('tech not found in this shop');
      const row = await ctx.d.insert('tech_time_off', { company_id: ctx.companyId, technician_id: a.technician_id, day, reason: a.reason || null });
      return { target_table: 'tech_time_off', target_id: row.id, path: null, op: 'insert', before: null, after: { technician_id: a.technician_id, day, reason: a.reason || null }, label: `Gave ${a.tech_name || 'tech'} ${new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} off` };
    },
  },
};

// reverse a stored action row back to its before-state
async function reverseAction(ctx, row) {
  if (row.op === 'insert') {
    if (row.target_table && row.target_id) await ctx.d.del(`${row.target_table}?id=eq.${row.target_id}&company_id=eq.${ctx.companyId}`);
    return;
  }
  if (row.op === 'update' && row.target_table === 'company' && row.path) {
    const keys = String(row.path).replace(/^settings\./, '').split('.');
    const rows = await ctx.d.get(`company?id=eq.${ctx.companyId}&select=settings`);
    const settings = (rows && rows[0] && rows[0].settings) || {};
    const restore = (row.before_value === null || row.before_value === undefined) ? undefined : row.before_value;
    const next = setPath(settings, keys, restore);
    await ctx.d.patch(`company?id=eq.${ctx.companyId}`, { settings: next });
    return;
  }
  if (row.op === 'update' && row.target_table === 'technician' && row.target_id) {
    const before = row.before_value || {};
    await ctx.d.patch(`technician?id=eq.${row.target_id}&company_id=eq.${ctx.companyId}`, before);
    return;
  }
  throw new Error('cannot reverse this action');
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });

  const q = event.queryStringParameters || {};
  const doAction = String(q.do || 'apply');
  let p = {}; try { p = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'bad json' }); }

  const { base, key } = await cfg();
  if (!base || !key) return json(500, { ok: false, error: 'platform not configured' });
  const d = db(base, key);

  // ---- authenticate + resolve company/role ----
  const token = String(p.access_token || '').trim();
  const user = await authUser(base, key, token);
  if (!user) return json(401, { ok: false, error: 'not signed in' });
  let who;
  try {
    const r = await fetch(`${base}/rest/v1/rpc/platform_whoami`, { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(8000) });
    const arr = await r.json().catch(() => []); who = Array.isArray(arr) ? arr[0] : arr;
  } catch (_) { who = null; }
  const companyId = who && who.company_id;
  const role = (who && who.role) || '';
  if (!companyId) return json(403, { ok: false, error: 'no company' });
  const MGMT = ['owner', 'office', 'manager', 'admin'];
  if (!MGMT.includes(role)) return json(403, { ok: false, error: 'role not allowed', role });

  const ctx = { d, companyId, role, actor: role };

  try {
    if (doAction === 'intents') {
      return json(200, { ok: true, intents: Object.keys(INTENTS).map((k) => ({ intent: k, desc: INTENTS[k].desc })) });
    }

    if (doAction === 'list') {
      const lim = Math.max(1, Math.min(100, parseInt(p.limit, 10) || 25));
      const rows = await d.get(`owner_action?company_id=eq.${companyId}&order=created_at.desc&limit=${lim}&select=id,actor,via,intent,label,before_value,after_value,op,status,reason,created_at,reversed_at`);
      return json(200, { ok: true, actions: rows });
    }

    if (doAction === 'apply') {
      const intent = String(p.intent || '');
      const spec = INTENTS[intent];
      if (!spec) return json(400, { ok: false, error: 'unknown intent: ' + intent });
      const res = await spec.apply(ctx, p.args || {});
      const via = p.via === 'ant' ? 'ant' : 'ui';
      const actor = via === 'ant' ? 'ant' : role;
      const logged = await d.insert('owner_action', {
        company_id: companyId, actor, via, intent, label: res.label,
        target_table: res.target_table || null, target_id: res.target_id || null, path: res.path || null,
        op: res.op || 'update', before_value: res.before ?? null, after_value: res.after ?? null,
        status: 'applied', reason: p.reason || null,
      });
      return json(200, { ok: true, action_id: logged.id, label: res.label, before: res.before ?? null, after: res.after ?? null });
    }

    if (doAction === 'undo') {
      const id = String(p.action_id || '');
      const rows = await d.get(`owner_action?id=eq.${id}&company_id=eq.${companyId}&select=*`);
      const row = rows && rows[0];
      if (!row) return json(404, { ok: false, error: 'action not found' });
      if (row.status === 'reversed') return json(200, { ok: true, action_id: id, label: row.label, note: 'already reversed' });
      await reverseAction(ctx, row);
      await d.patch(`owner_action?id=eq.${id}&company_id=eq.${companyId}`, { status: 'reversed', reversed_at: new Date().toISOString(), reversed_by: role });
      return json(200, { ok: true, action_id: id, label: row.label });
    }

    return json(400, { ok: false, error: 'unknown do: ' + doAction });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
