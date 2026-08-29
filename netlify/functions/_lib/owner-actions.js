// _lib/owner-actions — the ONE source of truth for the reversible action ledger.
// Both the human UI path (platform-owner-action.js) and the Ant brain (platform-ant.js)
// import this so the whitelisted intents + undo logic can never drift apart.
//
// Every apply captures the BEFORE value, applies the change, and logs an owner_action row.
// Every row can be undone because it carries its exact before-state. Writes use the platform
// service key but are ALWAYS scoped by the resolved company_id in code — never cross-tenant.
'use strict';

const { getSecret } = require('./secrets');
const MGMT = ['owner', 'office', 'manager', 'admin'];

async function cfg() {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { base: String(url).replace(/\/+$/, ''), key };
}
function db(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    async get(path) { const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(9000) }); if (!r.ok) throw new Error('get ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120)); return r.json(); },
    async patch(path, body) { const r = await fetch(`${base}/rest/v1/${path}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(body), signal: AbortSignal.timeout(9000) }); if (!r.ok) throw new Error('patch ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120)); const d = await r.json().catch(() => []); return Array.isArray(d) ? d[0] : d; },
    async insert(table, row) { const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row), signal: AbortSignal.timeout(9000) }); if (!r.ok) throw new Error('insert ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120)); const d = await r.json().catch(() => []); return Array.isArray(d) ? d[0] : d; },
    async del(path) { const r = await fetch(`${base}/rest/v1/${path}`, { method: 'DELETE', headers: H, signal: AbortSignal.timeout(9000) }); if (!r.ok) throw new Error('del ' + r.status); return true; },
  };
}
async function authUser(base, key, token) {
  if (!token) return null;
  try { const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000) }); if (!r.ok) return null; const u = await r.json(); return (u && u.id) ? u : null; } catch (_) { return null; }
}
async function whoami(base, key, token) {
  try { const r = await fetch(`${base}/rest/v1/rpc/platform_whoami`, { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(8000) }); const arr = await r.json().catch(() => []); return Array.isArray(arr) ? arr[0] : arr; } catch (_) { return null; }
}

// Resolve the caller into a scoped context. Returns { error } | { d, companyId, role, technicianId, base, key }
async function resolveCaller(token) {
  const { base, key } = await cfg();
  if (!base || !key) return { error: 'platform not configured' };
  const u = await authUser(base, key, token);
  if (!u) return { error: 'not signed in' };
  const w = await whoami(base, key, token);
  if (!w || !w.company_id) return { error: 'no company' };
  return { base, key, d: db(base, key), companyId: w.company_id, role: w.role || '', technicianId: w.technician_id || null };
}

// ---- nested settings helpers ----
function getPath(obj, keys) { let o = obj; for (const k of keys) { if (o == null || typeof o !== 'object') return undefined; o = o[k]; } return o; }
function setPath(obj, keys, value) {
  const root = obj && typeof obj === 'object' ? JSON.parse(JSON.stringify(obj)) : {};
  let o = root;
  for (let i = 0; i < keys.length - 1; i++) { const k = keys[i]; if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
  if (value === undefined) delete o[keys[keys.length - 1]]; else o[keys[keys.length - 1]] = value;
  return root;
}
const centsMoney = (c) => '$' + (Math.round(Number(c || 0)) / 100).toLocaleString('en-US', { minimumFractionDigits: 0 });
const commsLabel = { reminder: 'day-before reminder', otw: 'on-my-way text', arrived: 'arrived text', complete: 'job-done text', review: 'review request', offer: 'schedule offer', assigned: 'tech-assigned text' };

async function applyCompanySettingsPath(ctx, keys, newVal) {
  const rows = await ctx.d.get(`company?id=eq.${ctx.companyId}&select=settings`);
  const settings = (rows && rows[0] && rows[0].settings) || {};
  const before = getPath(settings, keys);
  await ctx.d.patch(`company?id=eq.${ctx.companyId}`, { settings: setPath(settings, keys, newVal) });
  return { target_table: 'company', target_id: null, path: 'settings.' + keys.join('.'), op: 'update', before: before === undefined ? null : before, after: newVal === undefined ? null : newVal };
}
async function applyTechField(ctx, techId, fields) {
  const rows = await ctx.d.get(`technician?id=eq.${techId}&company_id=eq.${ctx.companyId}&select=${Object.keys(fields).join(',')}`);
  if (!rows || !rows[0]) throw new Error('tech not found in this shop');
  const before = {}; Object.keys(fields).forEach((k) => { before[k] = rows[0][k]; });
  await ctx.d.patch(`technician?id=eq.${techId}&company_id=eq.${ctx.companyId}`, fields);
  return { target_table: 'technician', target_id: techId, path: null, op: 'update', before, after: fields };
}

// ---- the whitelist: each intent maps 1:1 to a control the owner already has ----
const INTENTS = {
  set_parts_margin: {
    args: 'markup_pct (0-300), optional min_add_cents',
    apply: async (ctx, a) => {
      const pct = Math.max(0, Math.min(300, Math.round(Number(a.markup_pct))));
      if (!isFinite(pct)) throw new Error('markup_pct required');
      const cur = getPath((await ctx.d.get(`company?id=eq.${ctx.companyId}&select=settings`))[0]?.settings || {}, ['parts']) || {};
      const val = { markup_pct: pct, min_add_cents: a.min_add_cents != null ? Math.max(0, Math.round(Number(a.min_add_cents))) : (cur.min_add_cents || 0) };
      const t = await applyCompanySettingsPath(ctx, ['parts'], val);
      const was = t.before && t.before.markup_pct;
      return { ...t, label: `Set parts margin to ${pct}%` + (was != null ? ` (was ${was}%)` : '') };
    },
  },
  toggle_comms: {
    args: 'key (reminder|otw|arrived|complete|review|offer|assigned), on (bool)',
    apply: async (ctx, a) => {
      const key = String(a.key || '').trim(); const on = !!a.on;
      if (!commsLabel[key]) throw new Error('unknown comms key');
      const t = await applyCompanySettingsPath(ctx, ['comms', key, 'on'], on);
      return { ...t, label: `Turned ${on ? 'ON' : 'OFF'} the ${commsLabel[key]}` };
    },
  },
  set_comms_text: {
    args: 'key, text',
    apply: async (ctx, a) => {
      const key = String(a.key || '').trim(); const text = String(a.text || '');
      if (!commsLabel[key]) throw new Error('unknown comms key');
      const t = await applyCompanySettingsPath(ctx, ['comms', key, 'text'], text);
      return { ...t, label: `Reworded the ${commsLabel[key]}` };
    },
  },
  set_goal: {
    args: 'kind (take_home|rating), value (take_home in CENTS, rating 0-5)',
    apply: async (ctx, a) => {
      const kind = String(a.kind || '').trim();
      if (kind !== 'take_home' && kind !== 'rating') throw new Error('kind must be take_home or rating');
      const val = kind === 'take_home' ? Math.max(0, Math.round(Number(a.value))) : Math.max(0, Math.min(5, Number(a.value)));
      const t = await applyCompanySettingsPath(ctx, ['goals', kind], val);
      return { ...t, label: kind === 'take_home' ? `Set take-home goal to ${centsMoney(val)}` : `Set rating goal to ${val.toFixed(1)}★` };
    },
  },
  set_tech_commission: {
    args: 'technician_id, pct (0-100), optional tech_name',
    apply: async (ctx, a) => {
      const pct = Math.max(0, Math.min(100, Number(a.pct)));
      const t = await applyTechField(ctx, a.technician_id, { commission_pct: pct, commission_type: 'percent' });
      return { ...t, label: `Set ${a.tech_name || 'tech'} commission to ${pct}%` + (t.before.commission_pct != null ? ` (was ${t.before.commission_pct}%)` : '') };
    },
  },
  set_tech_stops: {
    args: 'technician_id, max_stops (1-20), optional tech_name',
    apply: async (ctx, a) => {
      const n = Math.max(1, Math.min(20, Math.round(Number(a.max_stops))));
      const t = await applyTechField(ctx, a.technician_id, { max_stops: n });
      return { ...t, label: `Set ${a.tech_name || 'tech'} to ${n} stops/day` };
    },
  },
  set_tech_area: {
    args: 'technician_id, service_area (comma ZIPs/prefixes; empty=everywhere), optional tech_name',
    apply: async (ctx, a) => {
      const area = String(a.service_area || '').trim();
      const t = await applyTechField(ctx, a.technician_id, { service_area: area });
      return { ...t, label: `Set ${a.tech_name || 'tech'} service area to ${area || 'everywhere'}` };
    },
  },
  add_tech_dayoff: {
    args: 'technician_id, day (YYYY-MM-DD), optional reason, optional tech_name',
    apply: async (ctx, a) => {
      const day = String(a.day || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('day must be YYYY-MM-DD');
      const tk = await ctx.d.get(`technician?id=eq.${a.technician_id}&company_id=eq.${ctx.companyId}&select=id`);
      if (!tk || !tk[0]) throw new Error('tech not found in this shop');
      const row = await ctx.d.insert('tech_time_off', { company_id: ctx.companyId, technician_id: a.technician_id, day, reason: a.reason || null });
      return { target_table: 'tech_time_off', target_id: row.id, path: null, op: 'insert', before: null, after: { technician_id: a.technician_id, day, reason: a.reason || null }, label: `Gave ${a.tech_name || 'tech'} ${new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} off` };
    },
  },
};
const INTENTS_META = Object.keys(INTENTS).map((k) => ({ intent: k, args: INTENTS[k].args }));

async function reverseAction(ctx, row) {
  if (row.op === 'insert') { if (row.target_table && row.target_id) await ctx.d.del(`${row.target_table}?id=eq.${row.target_id}&company_id=eq.${ctx.companyId}`); return; }
  if (row.op === 'update' && row.target_table === 'company' && row.path) {
    const keys = String(row.path).replace(/^settings\./, '').split('.');
    const settings = ((await ctx.d.get(`company?id=eq.${ctx.companyId}&select=settings`))[0] || {}).settings || {};
    const restore = (row.before_value === null || row.before_value === undefined) ? undefined : row.before_value;
    await ctx.d.patch(`company?id=eq.${ctx.companyId}`, { settings: setPath(settings, keys, restore) });
    return;
  }
  if (row.op === 'update' && row.target_table === 'technician' && row.target_id) { await ctx.d.patch(`technician?id=eq.${row.target_id}&company_id=eq.${ctx.companyId}`, row.before_value || {}); return; }
  throw new Error('cannot reverse this action');
}

// ---- exported operations (both callers use these) ----
async function applyIntent(ctx, intent, args, opts = {}) {
  const spec = INTENTS[intent];
  if (!spec) return { ok: false, error: 'unknown intent: ' + intent };
  const res = await spec.apply(ctx, args || {});
  const via = opts.via === 'ant' ? 'ant' : 'ui';
  const actor = via === 'ant' ? 'ant' : (ctx.role || 'owner');
  const logged = await ctx.d.insert('owner_action', {
    company_id: ctx.companyId, actor, via, intent, label: res.label,
    target_table: res.target_table || null, target_id: res.target_id || null, path: res.path || null,
    op: res.op || 'update', before_value: res.before ?? null, after_value: res.after ?? null,
    status: 'applied', reason: opts.reason || null,
  });
  return { ok: true, action_id: logged.id, label: res.label, before: res.before ?? null, after: res.after ?? null };
}
async function undoAction(ctx, actionId) {
  const rows = await ctx.d.get(`owner_action?id=eq.${actionId}&company_id=eq.${ctx.companyId}&select=*`);
  const row = rows && rows[0];
  if (!row) return { ok: false, error: 'action not found' };
  if (row.status === 'reversed') return { ok: true, action_id: actionId, label: row.label, note: 'already reversed' };
  await reverseAction(ctx, row);
  await ctx.d.patch(`owner_action?id=eq.${actionId}&company_id=eq.${ctx.companyId}`, { status: 'reversed', reversed_at: new Date().toISOString(), reversed_by: ctx.role || 'owner' });
  return { ok: true, action_id: actionId, label: row.label };
}
async function listActions(ctx, limit) {
  const lim = Math.max(1, Math.min(100, parseInt(limit, 10) || 25));
  const rows = await ctx.d.get(`owner_action?company_id=eq.${ctx.companyId}&order=created_at.desc&limit=${lim}&select=id,actor,via,intent,label,before_value,after_value,op,status,reason,created_at,reversed_at`);
  return { ok: true, actions: rows };
}

module.exports = { resolveCaller, applyIntent, undoAction, listActions, INTENTS, INTENTS_META, MGMT, cfg, db, centsMoney };
