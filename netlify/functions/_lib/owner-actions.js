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
const UUID = /^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/;
function uid(x) { const s = String(x || ''); if (!UUID.test(s)) throw new Error('bad id'); return s; }
function prettyDay(d) { try { return new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); } catch (_) { return String(d); } }

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
      const tk = await ctx.d.get(`technician?id=eq.${uid(a.technician_id)}&company_id=eq.${ctx.companyId}&select=id`);
      if (!tk || !tk[0]) throw new Error('tech not found in this shop');
      const row = await ctx.d.insert('tech_time_off', { company_id: ctx.companyId, technician_id: a.technician_id, day, reason: a.reason || null });
      return { target_table: 'tech_time_off', target_id: row.id, path: null, op: 'insert', before: null, after: { technician_id: a.technician_id, day, reason: a.reason || null }, label: `Gave ${a.tech_name || 'tech'} ${prettyDay(day)} off` };
    },
  },
  // ---- CSR / dispatch hands: book, move, unschedule a job (all reversible) ----
  schedule_job: {
    args: 'job_id, optional technician_id, optional day (YYYY-MM-DD), optional tech_name. Books/moves a job — sets the tech and/or day and marks it scheduled.',
    apply: async (ctx, a) => {
      const jid = uid(a.job_id);
      const rows = await ctx.d.get(`job?id=eq.${jid}&company_id=eq.${ctx.companyId}&select=technician_id,scheduled_day,status`);
      if (!rows || !rows[0]) throw new Error('job not found in this shop');
      const before = { technician_id: rows[0].technician_id, scheduled_day: rows[0].scheduled_day, status: rows[0].status };
      const patch = { status: 'scheduled' };
      if (a.technician_id) { const tk = await ctx.d.get(`technician?id=eq.${uid(a.technician_id)}&company_id=eq.${ctx.companyId}&select=id`); if (!tk || !tk[0]) throw new Error('tech not found in this shop'); patch.technician_id = a.technician_id; }
      if (a.day) { const day = String(a.day).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('day must be YYYY-MM-DD'); patch.scheduled_day = day; }
      if (!patch.technician_id && !patch.scheduled_day) throw new Error('need a technician_id or a day');
      await ctx.d.patch(`job?id=eq.${jid}&company_id=eq.${ctx.companyId}`, patch);
      const moved = before.scheduled_day && before.technician_id;
      const label = (moved ? 'Moved ' : 'Booked ') + (a.tech_name ? a.tech_name + '’s job' : 'the job') + (patch.scheduled_day ? ' for ' + prettyDay(patch.scheduled_day) : '');
      return { target_table: 'job', target_id: a.job_id, path: null, op: 'update', before, after: patch, label };
    },
  },
  unschedule_job: {
    args: 'job_id. Takes a job back off the schedule (back to New).',
    apply: async (ctx, a) => {
      const jid = uid(a.job_id);
      const rows = await ctx.d.get(`job?id=eq.${jid}&company_id=eq.${ctx.companyId}&select=technician_id,scheduled_day,status`);
      if (!rows || !rows[0]) throw new Error('job not found in this shop');
      const before = { technician_id: rows[0].technician_id, scheduled_day: rows[0].scheduled_day, status: rows[0].status };
      const patch = { scheduled_day: null, status: 'new' };
      await ctx.d.patch(`job?id=eq.${jid}&company_id=eq.${ctx.companyId}`, patch);
      return { target_table: 'job', target_id: a.job_id, path: null, op: 'update', before, after: patch, label: 'Unscheduled the job (back to New)' };
    },
  },
  // ---- tech self-serve intents ----
  add_part_needed: {
    args: 'job_id, part (name, e.g. "water filter"), optional number, optional tech_name. Flags a part the office needs to order on that job.',
    apply: async (ctx, a) => {
      const jid = uid(a.job_id);
      const rows = await ctx.d.get(`job?id=eq.${jid}&company_id=eq.${ctx.companyId}&select=technician_id,customer:customer_id(first_name,last_name)`);
      const job = rows && rows[0];
      if (!job) throw new Error('job not found in this shop');
      if (!MGMT.includes(ctx.role) && String(job.technician_id) !== String(ctx.technicianId)) throw new Error('that is not your job');
      const part = String(a.part || '').trim();
      if (!part) throw new Error('what part?');
      const row = await ctx.d.insert('job_part', { company_id: ctx.companyId, job_id: jid, name: part, number: a.number ? String(a.number) : null, order_status: 'to_order' });
      const who = job.customer ? ((job.customer.first_name || '') + ' ' + (job.customer.last_name || '')).trim() : '';
      return { target_table: 'job_part', target_id: row.id, path: null, op: 'insert', before: null, after: { job_id: jid, name: part }, label: 'Added “' + part + '” to parts needed' + (who ? ' on ' + who + '’s job' : '') };
    },
  },
  request_day_off: {
    args: 'day (YYYY-MM-DD), optional reason. Puts in a day-off request for the SIGNED-IN tech only.',
    apply: async (ctx, a) => {
      if (!ctx.technicianId) throw new Error('not linked to a technician');
      const day = String(a.day || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('day must be YYYY-MM-DD');
      const row = await ctx.d.insert('tech_time_off', { company_id: ctx.companyId, technician_id: ctx.technicianId, day, reason: a.reason || null });
      return { target_table: 'tech_time_off', target_id: row.id, path: null, op: 'insert', before: null, after: { technician_id: ctx.technicianId, day, reason: a.reason || null }, label: 'Requested ' + prettyDay(day) + ' off' };
    },
  },
};
// the intents a non-management (tech) caller may apply/undo — self-scoped (own jobs / self)
const TECH_ALLOWED = ['request_day_off', 'add_part_needed'];
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
  // any other row-scoped update (technician, job) → restore the before-state on that row
  if (row.op === 'update' && row.target_table && row.target_table !== 'company' && row.target_id) { await ctx.d.patch(`${row.target_table}?id=eq.${row.target_id}&company_id=eq.${ctx.companyId}`, row.before_value || {}); return; }
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

// ---- #4 the pattern-learning layer ----
// The owner_action log IS the training set: no new data collection, we learn from what
// already accrues. Detects recurring behavior so Ant can act like THIS shop + stop pushing
// changes the person keeps undoing. Pure read; best-effort; degrades to [].
function modeOf(arr) { const c = {}; arr.forEach((v) => { c[v] = (c[v] || 0) + 1; }); let val = null, count = 0; Object.keys(c).forEach((k) => { if (c[k] > count) { count = c[k]; val = k; } }); return { val: (val != null && !isNaN(+val)) ? +val : val, count }; }
async function learnPatterns(ctx) {
  let rows = [];
  try { rows = await ctx.d.get(`owner_action?company_id=eq.${ctx.companyId}&order=created_at.desc&limit=300&select=intent,after_value,before_value,status,target_id,label,created_at`); } catch (_) { return []; }
  if (!rows || !rows.length) return [];
  const byIntent = {}; rows.forEach((r) => { (byIntent[r.intent] = byIntent[r.intent] || []).push(r); });
  const patterns = [];

  // 1. undo-prone intents — Ant should tread lightly here
  Object.keys(byIntent).forEach((intent) => {
    const list = byIntent[intent]; const rev = list.filter((r) => r.status === 'reversed').length;
    if (list.length >= 3 && rev / list.length >= 0.5) patterns.push({ key: 'undo_prone:' + intent, strength: rev + 2, avoid: true, title: 'You often undo “' + intent.replace(/_/g, ' ') + '”', detail: rev + ' of the last ' + list.length + ' were reversed — Ant will suggest this cautiously.' });
  });

  // 2. a go-to parts margin
  const margins = (byIntent['set_parts_margin'] || []).map((r) => r.after_value && r.after_value.markup_pct).filter((v) => v != null);
  if (margins.length >= 2) { const m = modeOf(margins); if (m.count >= 2) patterns.push({ key: 'margin_default', strength: m.count, title: 'Your go-to parts margin is ' + m.val + '%', detail: 'You’ve landed on ' + m.val + '% ' + m.count + ' times.', suggest: { intent: 'set_parts_margin', args: { markup_pct: m.val }, label: 'Make ' + m.val + '% the margin' } }); }

  // 3. a text they keep turning to the same state
  const commsCount = {};
  (byIntent['toggle_comms'] || []).forEach((r) => { const m = /Turned (ON|OFF) the (.+)/.exec(r.label || ''); if (m) { const k = m[1] + '|' + m[2]; commsCount[k] = (commsCount[k] || 0) + 1; } });
  Object.keys(commsCount).forEach((k) => { if (commsCount[k] >= 2) { const parts = k.split('|'); patterns.push({ key: 'comms:' + k, strength: commsCount[k], title: 'You keep turning ' + parts[0] + ' the ' + parts[1], detail: 'Done ' + commsCount[k] + ' times — Ant treats ' + parts[0].toLowerCase() + ' as your preference here.' }); } });

  // 4. booking defaults by area (schedule_job → job ZIP3 → the tech it usually goes to)
  const sj = (byIntent['schedule_job'] || []).filter((r) => r.after_value && r.after_value.technician_id && r.target_id);
  if (sj.length >= 3) {
    try {
      const jobIds = [...new Set(sj.map((r) => r.target_id))];
      const jr = await ctx.d.get(`job?id=in.(${jobIds.join(',')})&select=id,customer:customer_id(zip)`);
      const zipByJob = {}; jr.forEach((j) => { zipByJob[j.id] = (j.customer && j.customer.zip) || ''; });
      const techIds = [...new Set(sj.map((r) => r.after_value.technician_id))];
      const tr = await ctx.d.get(`technician?id=in.(${techIds.join(',')})&company_id=eq.${ctx.companyId}&select=id,name`);
      const techName = {}; tr.forEach((t) => { techName[t.id] = t.name; });
      const area = {};
      sj.forEach((r) => { const z = String(zipByJob[r.target_id] || '').slice(0, 3); if (!z) return; const t = r.after_value.technician_id; (area[z] = area[z] || {})[t] = (area[z][t] || 0) + 1; });
      Object.keys(area).forEach((z) => { const counts = area[z]; const tot = Object.keys(counts).reduce((a, k) => a + counts[k], 0); const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]; if (tot >= 3 && counts[top] / tot >= 0.6) patterns.push({ key: 'area:' + z, strength: counts[top] + 1, title: 'ZIP ' + z + 'xx jobs usually go to ' + (techName[top] || 'one tech'), detail: counts[top] + ' of your last ' + tot + ' bookings in ' + z + 'xx went to ' + (techName[top] || 'them') + ' — Ant will default to that.', tech_id: top, zip3: z }); });
    } catch (_) { /* booking-area learning is best-effort */ }
  }

  patterns.sort((a, b) => (b.strength || 0) - (a.strength || 0));
  return patterns.slice(0, 6);
}

module.exports = { resolveCaller, applyIntent, undoAction, listActions, learnPatterns, INTENTS, INTENTS_META, MGMT, TECH_ALLOWED, cfg, db, centsMoney };
