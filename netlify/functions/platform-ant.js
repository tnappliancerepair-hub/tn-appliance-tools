// platform-ant — the role-aware Ant partner brain.
//
// A server-side tool-calling Claude, authenticated as the caller and scoped to their shop.
// EYES: a live company-scoped snapshot (goals, money + pace, the levers, crew, board, settings)
//        read through the service key but always filtered by the resolved company_id.
// HANDS: the SAME whitelisted intents the owner UI uses (via _lib/owner-actions) — every act is
//        logged in owner_action with a one-tap Undo. Ant never writes raw data or crosses tenants.
//
// Leash (mode): advise = answer only, no tools · propose = stage changes for the UI to confirm ·
//               act = apply/undo for real. Non-management callers (techs) are read-only, always.
//
//   POST { access_token, message, history?, mode?, via? }
//     -> { ok, reply, actions:[{action_id,label}], proposals:[{intent,args}], mode, role }
'use strict';

const OA = require('./_lib/owner-actions');
const { getSecret } = require('./_lib/secrets');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
const MODEL = 'claude-sonnet-4-5-20250929';
const USD = (c) => '$' + Math.round(Number(c || 0) / 100).toLocaleString('en-US');

function monthStartISO() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1).toISOString(); }
function areaList(t) { return String(t.service_area || '').split(',').map((s) => s.trim()).filter(Boolean); }
function coversZip(t, zip) { const a = areaList(t); if (!a.length) return true; zip = String(zip || '').trim(); if (!zip) return true; return a.some((p) => zip === p || zip.indexOf(p) === 0); }

async function buildSnapshot(ctx) {
  const CID = ctx.companyId, d = ctx.d;
  const [coRows, invs, jobs, parts, payouts, techs, nsRows] = await Promise.all([
    d.get(`company?id=eq.${CID}&select=name,settings`),
    d.get(`invoice?select=job_id,total_cents,collected_cents,status,paid_at,created_at&limit=3000`),
    d.get(`job?select=id,status,technician_id,warranty_company,completed_at,created_at&limit=3000`),
    d.get(`job_part?select=job_id,cost_cents,disposition&limit=10000`),
    d.get(`tech_payout?select=amount_cents,paid_at&limit=5000`),
    d.get(`technician?select=id,name,active,commission_pct,max_stops,service_area&limit=200`),
    d.get(`job?select=id,status,problem,scheduled_day,technician_id,warranty_company,customer:customer_id(first_name,last_name,zip,city)&status=not.in.(completed,canceled)&limit=500`),
  ]);
  const co = (coRows && coRows[0]) || {}; const settings = co.settings || {};
  const ms = Date.parse(monthStartISO());
  const inMonth = (t) => t && Date.parse(t) >= ms;
  const jobById = {}; jobs.forEach((j) => { jobById[j.id] = j; });
  const invByJob = {}; const billedJobIds = {};
  let collected = 0, billed = 0, unpaidN = 0, unpaidCents = 0;
  invs.forEach((v) => {
    if (v.job_id) invByJob[v.job_id] = v;
    if (inMonth(v.created_at)) { collected += v.collected_cents || 0; billed += v.total_cents || 0; billedJobIds[v.job_id] = 1; }
    const due = (v.total_cents || 0) - (v.collected_cents || 0);
    const j = jobById[v.job_id];
    if (v.status !== 'paid' && due > 0 && j && !j.warranty_company) { unpaidN++; unpaidCents += due; }
  });
  let techPaidMonth = 0; payouts.forEach((p) => { if (inMonth(p.paid_at)) techPaidMonth += p.amount_cents || 0; });
  let partsCost = 0; parts.forEach((p) => { const disp = p.disposition || ''; if (disp === 'return' || disp === 'unused' || disp === 'missing') return; if (billedJobIds[p.job_id]) partsCost += p.cost_cents || 0; });
  const takeHome = collected - techPaidMonth - partsCost;
  // completed jobs with no invoice = money finished but not billed
  let unbilledN = 0; jobs.forEach((j) => { if (j.status === 'completed' && !invByJob[j.id]) unbilledN++; });
  // board counts
  const board = {}; jobs.forEach((j) => { board[j.status] = (board[j.status] || 0) + 1; });
  // goals + pace
  const goals = settings.goals || {};
  let pace = null;
  if (goals.take_home > 0) {
    const prog = Math.max(0, Math.min(1, takeHome / goals.take_home));
    const now = new Date(), dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), el = now.getDate() / dim;
    const delta = Math.round((prog - el) * goals.take_home);
    pace = { pct: Math.round(prog * 100), ahead: delta >= 0, delta_cents: Math.abs(delta), remaining_cents: Math.max(0, goals.take_home - takeHome) };
  }
  // comms that are OFF
  const comms = settings.comms || {}; const commsOff = Object.keys(comms).filter((k) => comms[k] && comms[k].on === false);
  const crew = (techs || []).filter((t) => t.active !== false).map((t) => ({ id: t.id, name: t.name, commission_pct: t.commission_pct, max_stops: t.max_stops, service_area: t.service_area || '' }));
  const activeCrew = (techs || []).filter((t) => t.active !== false);
  // the unscheduled queue (jobs needing a tech and/or a day) + who covers each ZIP
  const needs = (nsRows || []).filter((j) => (!j.scheduled_day || !j.technician_id)).slice(0, 12).map((j) => {
    const c = j.customer || {}; const zip = String(c.zip || '');
    const cov = activeCrew.filter((t) => coversZip(t, zip)).map((t) => ({ id: t.id, name: t.name }));
    return { job_id: j.id, customer: ((c.first_name || '') + ' ' + (c.last_name || '')).trim() || 'Customer', problem: j.problem || '', zip, city: c.city || '', warranty: !!j.warranty_company, covering_techs: cov };
  });
  const now2 = new Date();
  return {
    shop: co.name || 'the shop',
    today: now2.toISOString().slice(0, 10) + ' (' + now2.toLocaleDateString('en-US', { weekday: 'long' }) + ')',
    goals: { take_home_cents: goals.take_home != null ? goals.take_home : null, rating: goals.rating != null ? goals.rating : null },
    money_this_month: { collected: USD(collected), billed: USD(billed), take_home_est: USD(takeHome), take_home_note: 'estimate = collected − paid-out crew − parts cost; excludes crew pay still owed' },
    pace: pace ? { percent_to_goal: pace.pct, status: pace.ahead ? 'ahead' : 'behind', by: USD(pace.delta_cents), remaining_to_goal: USD(pace.remaining_cents) } : 'no take-home goal set yet',
    levers: {
      finished_not_billed: unbilledN + ' completed job(s) with no invoice yet',
      unpaid_invoices: unpaidN + ' unpaid self-pay invoice(s) worth ' + USD(unpaidCents),
    },
    parts_margin: { markup_pct: (settings.parts && settings.parts.markup_pct != null) ? settings.parts.markup_pct : 50 },
    texts_turned_off: commsOff.length ? commsOff : 'none (all automated texts on)',
    crew,
    board: { scheduled: board.scheduled || 0, awaiting_parts: board.awaiting_parts || 0, in_progress: board.in_progress || 0, completed: board.completed || 0, new: board['new'] || 0 },
    needs_scheduling: { count: needs.length, jobs: needs },
  };
}

// ---- tech (money-maker) helpers: everything scoped to the SIGNED-IN tech only ----
function inMonthTs(t, ms) { return t && Date.parse(t) >= ms; }
function custName(j) { const c = j.customer || {}; return ((c.first_name || '') + ' ' + (c.last_name || '')).trim() || 'Customer'; }
async function brainLookup(base, key, a) {
  try {
    const r = await fetch(`${base}/rest/v1/rpc/brain_lookup`, { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_brand: a.brand || null, p_model: a.model || null, p_symptom: a.symptom || null, p_unit_kind: a.unit_kind || null, p_trade: a.trade || 'appliance' }), signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { ok: false, error: 'lookup ' + r.status }; const rows = await r.json().catch(() => []);
    return { ok: true, results: Array.isArray(rows) ? rows.slice(0, 5) : rows };
  } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 80) }; }
}
async function buildTechSnapshot(ctx) {
  const TID = ctx.technicianId, d = ctx.d;
  const [meRows, jobs, invs, payouts, coRows] = await Promise.all([
    d.get(`technician?id=eq.${TID}&select=name,commission_pct,commission_type,commission_flat_cents,max_stops&limit=1`),
    d.get(`job?technician_id=eq.${TID}&select=id,status,problem,scheduled_day,first_stop,completed_at,created_at,customer:customer_id(first_name,last_name,zip,city)&limit=1500`),
    d.get(`invoice?select=job_id,labor_cents,collected_cents,status,paid_at&limit=3000`),
    d.get(`tech_payout?technician_id=eq.${TID}&select=amount_cents,paid_at&limit=3000`),
    d.get(`company?id=eq.${ctx.companyId}&select=name`),
  ]);
  const me = (meRows && meRows[0]) || {};
  const shopName = (coRows && coRows[0] && coRows[0].name) || 'your shop';
  const flat = me.commission_type === 'flat';
  const pct = flat ? null : (me.commission_pct != null ? +me.commission_pct : null);
  const myJob = {}; jobs.forEach((j) => { myJob[j.id] = j; });
  const invByJob = {}; invs.forEach((v) => { if (myJob[v.job_id]) invByJob[v.job_id] = v; });
  const ms = Date.parse(monthStartISO());
  let earnedMonth = 0, collectedEarnedLife = 0;
  jobs.forEach((j) => {
    if (j.status !== 'completed') return; const v = invByJob[j.id]; if (!v) return;
    const cut = flat ? (me.commission_flat_cents || 0) : Math.round((v.labor_cents || 0) * (pct != null ? pct : 0) / 100);
    if (inMonthTs(j.completed_at || j.created_at, ms)) earnedMonth += cut;
    if (v.status === 'paid') collectedEarnedLife += cut;
  });
  let paidLife = 0, paidMonth = 0; payouts.forEach((p) => { paidLife += p.amount_cents || 0; if (inMonthTs(p.paid_at, ms)) paidMonth += p.amount_cents || 0; });
  const owedNow = Math.max(0, collectedEarnedLife - paidLife);
  const todayIso = new Date().toISOString().slice(0, 10);
  const upcoming = jobs.filter((j) => j.status !== 'completed' && j.status !== 'canceled' && j.scheduled_day).sort((a, b) => String(a.scheduled_day).localeCompare(String(b.scheduled_day))).slice(0, 12).map((j) => ({ customer: custName(j), day: j.scheduled_day, appliance_problem: j.problem || '', zip: (j.customer && j.customer.zip) || '', city: (j.customer && j.customer.city) || '' }));
  const todays = upcoming.filter((j) => j.day === todayIso);
  const doneMonth = jobs.filter((j) => j.status === 'completed' && inMonthTs(j.completed_at || j.created_at, ms)).length;
  const fsK = jobs.filter((j) => j.status === 'completed' && (j.first_stop === true || j.first_stop === false));
  const fsY = fsK.filter((j) => j.first_stop === true).length;
  return {
    shop: shopName,
    tech: me.name || 'you',
    today: todayIso,
    your_money: { earned_this_month: USD(earnedMonth), owed_to_you_now: USD(owedNow), paid_this_month: USD(paidMonth), how: 'Your cut of labor on completed jobs. Owed-now = collected on your jobs but not paid out yet. Commission: ' + (flat ? 'flat per job' : (pct != null ? pct + '% of labor' : 'not set — ask the office')) },
    your_day: { today: todays, upcoming: upcoming },
    your_month: { jobs_completed: doneMonth, first_trip_fix: fsK.length ? Math.round(100 * fsY / fsK.length) + '% (of ' + fsK.length + ' with a report)' : 'no reports yet' },
  };
}

function systemPrompt(role, mode, snap) {
  const isMgmt = OA.MGMT.includes(role);
  const seat = role === 'office' || role === 'manager' ? 'the front desk / dispatcher' : (role === 'owner' ? 'the owner' : 'a technician — a money-maker out in the field');
  const intentDoc = OA.INTENTS_META.map((i) => `  - ${i.intent}: ${i.args}`).join('\n');
  let handMode;
  if (!isMgmt) handMode = 'You help the tech make money and get through the day. You CAN: look up what usually fixes an appliance (whats_usually_fixes) and put in a day-off request for THEM (request_day_off, logged with an Undo). You canNOT change shop settings, pay, pricing, or anyone else’s schedule — if they ask for that, tell them the office/owner handles it.';
  else if (mode === 'advise') handMode = 'ADVISE ONLY right now — recommend the change in plain words, do NOT call any tool.';
  else if (mode === 'propose') handMode = 'PROPOSE mode — when a change is warranted, call propose_change to stage it (this does NOT execute); the person will tap Confirm. Describe what you staged.';
  else handMode = 'ACT mode — when the person clearly wants a change, DO IT by calling apply_intent. Tell them it is done and logged with an Undo. Use undo_action to reverse a prior action by its id. Only act on clear requests; if unsure, ask first.';
  return [
    `You are Ant 🐜, the AI partner inside AssistAnt, talking with ${seat} at ${snap.shop}.`,
    `You are a genuine partner in this business — warm, brief, and concrete. Use REAL numbers from the snapshot. Never invent figures. One or two short paragraphs, plain language, like a sharp colleague who's caught up. Never mention tables, SQL, or internal fields.`,
    `If a LEARNED_PLAYBOOK is in the snapshot, it's how THIS shop already does things (from their own history) — prefer it: default to the tech/margin/settings they usually choose, and do NOT push a change they repeatedly undo. That's how you get easier to work with over time.`,
    role === 'owner' ? `Orient everything toward the owner's two goals (take-home + rating). When money comes up, name the fastest way to close the gap using the levers (finished-not-billed, unpaid invoices).` : '',
    (!isMgmt) ? `You're the tech's partner and hype-man — honest, in their corner. When they ask how they're doing, LEAD WITH THE MONEY: what they earned this month, what's owed to them right now, what's been paid. Remind them the money grows by finishing jobs and fixing on the first trip. For "what's wrong / how do I fix this," call whats_usually_fixes. Keep it short and real.` : '',
    (role === 'office' || role === 'manager') ? `You run the board and the day. You can BOOK, MOVE, and UNSCHEDULE jobs, plus toggle customer texts and set days off.\n- To book: schedule_job { job_id, technician_id, day:"YYYY-MM-DD", tech_name }. Pick a tech from that job's covering_techs (they cover the ZIP); prefer one already routed nearby that day and with room (max_stops). Resolve weekday names to a real date using 'today' in the snapshot (e.g. the next Thursday on/after today). Pass tech_name for a clean log line.\n- To move: schedule_job with a new day and/or technician_id. To pull one back: unschedule_job { job_id }.\n- The 'needs_scheduling' list is your work queue — job_id, customer, ZIP, and who covers it. After you book, tell them the office will text the customer their arrival window.` : '',
    `\nWhat you can change (each maps to a real control and is fully reversible):\n${intentDoc}`,
    `\nHands: ${handMode}`,
    `\nSAFETY: everything you touch is scoped to THIS shop only and logged with an Undo. You can never see or change another shop.`,
    `\n--- LIVE SNAPSHOT of ${snap.shop} (this month) ---\n${JSON.stringify(snap, null, 1)}`,
  ].filter(Boolean).join('\n');
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let p = {}; try { p = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'bad json' }); }
  const message = String(p.message || '').trim();
  if (!message) return json(400, { ok: false, error: 'empty message' });

  const caller = await OA.resolveCaller(String(p.access_token || '').trim());
  if (caller.error) return json(caller.error === 'not signed in' ? 401 : 403, { ok: false, error: caller.error });
  const role = caller.role, isMgmt = OA.MGMT.includes(role);
  const isTech = !isMgmt && !!caller.technicianId;
  const ctx = { d: caller.d, companyId: caller.companyId, role, technicianId: caller.technicianId };
  const mode = isMgmt ? (['advise', 'propose', 'act'].includes(p.mode) ? p.mode : 'act') : 'advise';

  const KEY = (await getSecret('ANTHROPIC_API_KEY')) || process.env.ANTHROPIC_API_KEY || '';
  if (!KEY) return json(200, { ok: false, error: 'brain not configured' });

  // techs see ONLY their own money + day (scoped to their technician_id); staff see the shop.
  let snap; try { snap = isTech ? await buildTechSnapshot(ctx) : await buildSnapshot(ctx); } catch (e) { return json(200, { ok: false, error: 'snapshot: ' + String(e && e.message || e).slice(0, 120) }); }
  // #4 — the learned playbook (mgmt only; a tech doesn't run the shop's playbook)
  if (isMgmt) { try { const pats = await OA.learnPatterns(ctx); if (pats && pats.length) snap.learned_playbook = pats.map((p) => p.title + (p.avoid ? ' — they often undo this, tread lightly' : (p.detail ? ' (' + p.detail + ')' : ''))); } catch (_) {} }

  // tools by seat + leash
  const intentEnum = OA.INTENTS_META.map((i) => i.intent);
  const applyTool = { name: 'apply_intent', description: 'Make a change for the shop (logged + reversible). Provide intent and its args.', input_schema: { type: 'object', properties: { intent: { type: 'string', enum: intentEnum }, args: { type: 'object', description: 'the args for that intent' } }, required: ['intent', 'args'] } };
  const undoTool = { name: 'undo_action', description: 'Reverse a prior action by its owner_action id.', input_schema: { type: 'object', properties: { action_id: { type: 'string' } }, required: ['action_id'] } };
  const proposeTool = { name: 'propose_change', description: 'Stage a change for the person to Confirm (does NOT execute). Provide intent and args.', input_schema: { type: 'object', properties: { intent: { type: 'string', enum: intentEnum }, args: { type: 'object' } }, required: ['intent', 'args'] } };
  const fixesTool = { name: 'whats_usually_fixes', description: 'Look up what usually fixes an appliance across the trade (de-identified). Use when asked to diagnose or "how do I fix this".', input_schema: { type: 'object', properties: { brand: { type: 'string' }, model: { type: 'string' }, symptom: { type: 'string' }, unit_kind: { type: 'string', description: 'washer, dryer, fridge, etc.' } }, required: ['brand'] } };
  const dayOffTool = { name: 'request_day_off', description: 'Put in a day-off request for the signed-in tech (themselves only). Logged with an Undo.', input_schema: { type: 'object', properties: { day: { type: 'string', description: 'YYYY-MM-DD' }, reason: { type: 'string' } }, required: ['day'] } };
  let tools = [fixesTool];
  if (isTech) tools.push(dayOffTool);
  else if (isMgmt && mode === 'act') tools.push(applyTool, undoTool);
  else if (isMgmt && mode === 'propose') tools.push(proposeTool);

  const messages = [];
  (Array.isArray(p.history) ? p.history : []).slice(-8).forEach((t) => { if (t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string') messages.push({ role: t.role, content: t.content }); });
  messages.push({ role: 'user', content: message });

  const actions = [], proposals = [];
  const started = Date.now();
  let finalText = '';
  try {
    for (let iter = 0; iter < 4; iter++) {
      if (Date.now() - started > 20000) break;
      const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 13000);
      let resp;
      try {
        resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: MODEL, max_tokens: 900, system: [{ type: 'text', text: systemPrompt(role, mode, snap), cache_control: { type: 'ephemeral' } }], tools: tools.length ? tools : undefined, messages }),
          signal: ac.signal,
        });
      } finally { clearTimeout(to); }
      if (!resp.ok) { const t = await resp.text().catch(() => ''); return json(200, { ok: false, error: 'brain ' + resp.status, detail: t.slice(0, 160) }); }
      const data = await resp.json();
      const blocks = data.content || [];
      const toolUses = blocks.filter((b) => b.type === 'tool_use');
      if (!toolUses.length) { finalText = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim(); break; }
      messages.push({ role: 'assistant', content: blocks });
      const results = [];
      for (const tu of toolUses) {
        let out;
        try {
          if (tu.name === 'whats_usually_fixes') { out = await brainLookup(caller.base, caller.key, tu.input || {}); }
          else if (tu.name === 'request_day_off') { if (!isTech) { out = { ok: false, error: 'only a tech can use this' }; } else { const r = await OA.applyIntent(ctx, 'request_day_off', { day: tu.input.day, reason: tu.input.reason }, { via: 'ant' }); if (r.ok) actions.push({ action_id: r.action_id, label: r.label }); out = r; } }
          else if (tu.name === 'apply_intent') { if (!isMgmt) { out = { ok: false, error: 'not allowed for your role' }; } else { const r = await OA.applyIntent(ctx, String(tu.input.intent), tu.input.args || {}, { via: 'ant', reason: 'via Ant chat' }); if (r.ok) actions.push({ action_id: r.action_id, label: r.label }); out = r; } }
          else if (tu.name === 'undo_action') { if (!isMgmt) { out = { ok: false, error: 'not allowed for your role' }; } else { const r = await OA.undoAction(ctx, String(tu.input.action_id)); if (r.ok) actions.push({ action_id: r.action_id, label: 'Undid: ' + (r.label || '') }); out = r; } }
          else if (tu.name === 'propose_change') { proposals.push({ intent: String(tu.input.intent), args: tu.input.args || {} }); out = { ok: true, staged: true }; }
          else out = { ok: false, error: 'unknown tool' };
        } catch (e) { out = { ok: false, error: String(e && e.message || e).slice(0, 140) }; }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 4000) });
      }
      messages.push({ role: 'user', content: results });
    }
  } catch (e) { return json(200, { ok: false, error: 'brain_failed: ' + String(e && e.message || e).slice(0, 120) }); }

  if (!finalText) finalText = actions.length ? 'Done — that\'s in your log with an Undo.' : 'I\'m here — ask me how you\'re doing or tell me what to change.';
  return json(200, { ok: true, reply: finalText, actions, proposals, mode, role });
};
