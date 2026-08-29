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

async function buildSnapshot(ctx) {
  const CID = ctx.companyId, d = ctx.d;
  const [coRows, invs, jobs, parts, payouts, techs] = await Promise.all([
    d.get(`company?id=eq.${CID}&select=name,settings`),
    d.get(`invoice?select=job_id,total_cents,collected_cents,status,paid_at,created_at&limit=3000`),
    d.get(`job?select=id,status,technician_id,warranty_company,completed_at,created_at&limit=3000`),
    d.get(`job_part?select=job_id,cost_cents,disposition&limit=10000`),
    d.get(`tech_payout?select=amount_cents,paid_at&limit=5000`),
    d.get(`technician?select=id,name,active,commission_pct,max_stops,service_area&limit=200`),
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
  return {
    shop: co.name || 'the shop',
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
  };
}

function systemPrompt(role, mode, snap) {
  const isMgmt = OA.MGMT.includes(role);
  const seat = role === 'office' || role === 'manager' ? 'the front desk / dispatcher' : (role === 'owner' ? 'the owner' : 'a technician');
  const intentDoc = OA.INTENTS_META.map((i) => `  - ${i.intent}: ${i.args}`).join('\n');
  let handMode;
  if (!isMgmt) handMode = 'You can ONLY advise — you cannot change settings for this seat. Answer from the numbers and suggest what they could ask the office/owner to do.';
  else if (mode === 'advise') handMode = 'ADVISE ONLY right now — recommend the change in plain words, do NOT call any tool.';
  else if (mode === 'propose') handMode = 'PROPOSE mode — when a change is warranted, call propose_change to stage it (this does NOT execute); the person will tap Confirm. Describe what you staged.';
  else handMode = 'ACT mode — when the person clearly wants a change, DO IT by calling apply_intent. Tell them it is done and logged with an Undo. Use undo_action to reverse a prior action by its id. Only act on clear requests; if unsure, ask first.';
  return [
    `You are Ant 🐜, the AI partner inside AssistAnt, talking with ${seat} at ${snap.shop}.`,
    `You are a genuine partner in this business — warm, brief, and concrete. Use REAL numbers from the snapshot. Never invent figures. One or two short paragraphs, plain language, like a sharp colleague who's caught up. Never mention tables, SQL, or internal fields.`,
    role === 'owner' ? `Orient everything toward the owner's two goals (take-home + rating). When money comes up, name the fastest way to close the gap using the levers (finished-not-billed, unpaid invoices).` : '',
    (role === 'office' || role === 'manager') ? `You help run the board and the day. You can answer scheduling/board questions from the snapshot. You can also toggle customer texts and set days off. Booking a specific job onto a tech isn't wired into your tools yet — if asked, say you'll have it soon and offer what you can do now.` : '',
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
  const ctx = { d: caller.d, companyId: caller.companyId, role };
  const mode = isMgmt ? (['advise', 'propose', 'act'].includes(p.mode) ? p.mode : 'act') : 'advise';

  const KEY = (await getSecret('ANTHROPIC_API_KEY')) || process.env.ANTHROPIC_API_KEY || '';
  if (!KEY) return json(200, { ok: false, error: 'brain not configured' });

  let snap; try { snap = await buildSnapshot(ctx); } catch (e) { return json(200, { ok: false, error: 'snapshot: ' + String(e && e.message || e).slice(0, 120) }); }

  // tools depend on the leash
  const intentEnum = OA.INTENTS_META.map((i) => i.intent);
  const applyTool = { name: 'apply_intent', description: 'Make a change for the shop (logged + reversible). Provide intent and its args.', input_schema: { type: 'object', properties: { intent: { type: 'string', enum: intentEnum }, args: { type: 'object', description: 'the args for that intent' } }, required: ['intent', 'args'] } };
  const undoTool = { name: 'undo_action', description: 'Reverse a prior action by its owner_action id.', input_schema: { type: 'object', properties: { action_id: { type: 'string' } }, required: ['action_id'] } };
  const proposeTool = { name: 'propose_change', description: 'Stage a change for the person to Confirm (does NOT execute). Provide intent and args.', input_schema: { type: 'object', properties: { intent: { type: 'string', enum: intentEnum }, args: { type: 'object' } }, required: ['intent', 'args'] } };
  let tools = [];
  if (isMgmt && mode === 'act') tools = [applyTool, undoTool];
  else if (isMgmt && mode === 'propose') tools = [proposeTool];

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
          if (tu.name === 'apply_intent') { const r = await OA.applyIntent(ctx, String(tu.input.intent), tu.input.args || {}, { via: 'ant', reason: 'via Ant chat' }); if (r.ok) actions.push({ action_id: r.action_id, label: r.label }); out = r; }
          else if (tu.name === 'undo_action') { const r = await OA.undoAction(ctx, String(tu.input.action_id)); if (r.ok) actions.push({ action_id: r.action_id, label: 'Undid: ' + (r.label || '') }); out = r; }
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
