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
let sendSms; try { ({ sendSms } = require('./_lib/sms')); } catch (_) { sendSms = null; }
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
// text the signed-in tech a reminder on their OWN phone (technician -> app_user.phone). Not reversible.
async function textTech(caller, ctx, message) {
  if (!ctx.technicianId) return { ok: false, error: 'not a tech' };
  if (!sendSms) return { ok: false, error: 'texting unavailable' };
  try {
    const tr = await ctx.d.get(`technician?id=eq.${ctx.technicianId}&company_id=eq.${ctx.companyId}&select=app_user_id`);
    const auId = tr && tr[0] && tr[0].app_user_id;
    if (!auId) return { ok: false, error: 'no login linked' };
    const ur = await ctx.d.get(`app_user?id=eq.${auId}&select=phone`);
    const phone = ur && ur[0] && ur[0].phone;
    if (!phone) return { ok: false, error: 'no phone on file — ask the office to add your cell' };
    const body = '🔧 Ant reminder: ' + String(message || '').slice(0, 300);
    await sendSms(phone, body, 'technician', 'tech_reminder');
    return { ok: true, texted: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 100) }; }
}
// office/owner -> text a chosen TECH a link to a specific customer's job + a note. Not reversible
// (a text can't be unsent), so it's a brain tool, not a ledger intent. Resolves tech + job by name.
const SITE = 'https://tnapplianceexchange.net';
const ilk = (s) => 'ilike.*' + encodeURIComponent(String(s || '').trim()) + '*';
async function textTechJob(caller, ctx, a) {
  if (!OA.MGMT.includes(ctx.role)) return { ok: false, error: 'only the office or owner can text a tech' };
  if (!sendSms) return { ok: false, error: 'texting unavailable' };
  const d = ctx.d, CID = ctx.companyId;
  // 1) resolve the tech (by id from a prior candidates list, else fuzzy by name)
  const crew = await d.get(`technician?company_id=eq.${CID}&active=neq.false&select=id,name,app_user_id&limit=200`);
  let tech = null;
  if (a.technician_id) tech = (crew || []).find((t) => String(t.id) === String(a.technician_id));
  if (!tech && a.tech) {
    const q = String(a.tech).trim().toLowerCase();
    const hits = (crew || []).filter((t) => String(t.name || '').toLowerCase().includes(q));
    if (hits.length === 1) tech = hits[0];
    else if (hits.length > 1) return { ok: false, error: 'which tech did you mean?', candidates: hits.map((t) => t.name) };
  }
  if (!tech) return { ok: false, error: 'no tech by that name', crew: (crew || []).map((t) => t.name) };
  // 2) their cell
  let phone = '';
  if (tech.app_user_id) { const au = await d.get(`app_user?id=eq.${tech.app_user_id}&select=phone`); phone = (au && au[0] && au[0].phone) ? String(au[0].phone).trim() : ''; }
  if (!phone) return { ok: false, error: 'no cell on file for ' + tech.name + ' — add it on the crew page first' };
  // 3) resolve the job (explicit job_id, else by customer name -> their open job)
  let job = null, custName2 = '';
  if (a.job_id) {
    const jid = String(a.job_id).replace(/[^0-9a-fA-F-]/g, '');
    const jr = await d.get(`job?id=eq.${jid}&company_id=eq.${CID}&select=id,problem,status,unit_id,customer:customer_id(first_name,last_name)`);
    job = jr && jr[0];
    if (job) { const c = job.customer || {}; custName2 = ((c.first_name || '') + ' ' + (c.last_name || '')).trim(); }
  } else if (a.customer) {
    const nm = String(a.customer).trim(); const parts = nm.split(/\s+/).filter(Boolean);
    const first = parts[0] || '', last = parts.length > 1 ? parts[parts.length - 1] : '';
    let cust = await d.get(`customer?company_id=eq.${CID}&last_name=${ilk(last || nm)}&select=id,first_name,last_name&limit=25`);
    if ((!cust || !cust.length)) cust = await d.get(`customer?company_id=eq.${CID}&first_name=${ilk(first || nm)}&select=id,first_name,last_name&limit=25`);
    if (cust && cust.length > 1 && first) { const f = first.toLowerCase(); const nar = cust.filter((c) => String(c.first_name || '').toLowerCase().startsWith(f)); if (nar.length) cust = nar; }
    if (!cust || !cust.length) return { ok: false, error: 'no customer named "' + nm + '" in this shop' };
    const ids = cust.map((c) => c.id);
    const nameById = {}; cust.forEach((c) => { nameById[c.id] = ((c.first_name || '') + ' ' + (c.last_name || '')).trim(); });
    // open (non-terminal) jobs first; fall back to any non-canceled
    let jrows = await d.get(`job?company_id=eq.${CID}&customer_id=in.(${ids.join(',')})&status=not.in.(completed,canceled)&select=id,problem,status,unit_id,customer_id,scheduled_day&order=created_at.desc&limit=25`);
    if (!jrows || !jrows.length) jrows = await d.get(`job?company_id=eq.${CID}&customer_id=in.(${ids.join(',')})&status=neq.canceled&select=id,problem,status,unit_id,customer_id,scheduled_day&order=created_at.desc&limit=25`);
    if (!jrows || !jrows.length) return { ok: false, error: 'no active job for ' + nm };
    if (jrows.length > 1) return { ok: false, error: 'more than one job for that customer — which one?', candidates: jrows.map((j) => ({ job_id: j.id, customer: nameById[j.customer_id] || nm, problem: j.problem || '', status: j.status, day: j.scheduled_day || 'unscheduled' })) };
    job = jrows[0]; custName2 = nameById[job.customer_id] || nm;
  } else {
    return { ok: false, error: 'which customer’s job?' };
  }
  if (!job) return { ok: false, error: 'job not found' };
  // 4) build the link + message + send
  const unit = job.unit_id ? (((await d.get(`unit?id=eq.${job.unit_id}&select=label`))[0]) || {}).label : '';
  const detail = unit || job.problem || '';
  const note = String(a.note || '').trim();
  const link = `${SITE}/platform/tech-job.html?job=${encodeURIComponent(job.id)}`;
  const body = '🧰 From the office' + (note ? ': ' + note.slice(0, 200) : '') + '\n' + (custName2 || 'Customer') + (detail ? ' · ' + detail : '') + '\n' + link;
  let sent = false; try { sent = await sendSms(phone, body, 'technician', 'platform_office_to_tech'); } catch (_) {}
  // reflect it on the job thread so the board shows the office pinged the tech
  try { const c2 = await d.get(`job?id=eq.${job.id}&select=customer_id`); const cid2 = c2 && c2[0] && c2[0].customer_id; if (cid2) await ctx.d.insert('thread_message', { company_id: CID, customer_id: cid2, job_id: job.id, direction: 'out', channel: 'assign', sender: 'office', body: '🧰 Texted ' + tech.name + ' the job link' + (note ? ' — "' + note.slice(0, 120) + '"' : '') }); } catch (_) {}
  return { ok: true, texted: sent, tech: tech.name, customer: custName2 || 'the customer', job_id: job.id, link };
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
  // today = anything scheduled today OR worked/finished today (so Ant can reference "the X job from today")
  const todays = jobs.filter((j) => j.scheduled_day === todayIso || String(j.completed_at || '').slice(0, 10) === todayIso).map((j) => ({ job_id: j.id, customer: custName(j), status: j.status, appliance_problem: j.problem || '', zip: (j.customer && j.customer.zip) || '' }));
  const upcoming = jobs.filter((j) => j.status !== 'completed' && j.status !== 'canceled' && j.scheduled_day && j.scheduled_day > todayIso).sort((a, b) => String(a.scheduled_day).localeCompare(String(b.scheduled_day))).slice(0, 12).map((j) => ({ job_id: j.id, customer: custName(j), day: j.scheduled_day, appliance_problem: j.problem || '', zip: (j.customer && j.customer.zip) || '', city: (j.customer && j.customer.city) || '' }));
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
  if (!isMgmt) handMode = 'You help the tech make money and get through the day, hands-free — they\'re often driving, so keep it short and just DO it. You CAN: look up what usually fixes an appliance (whats_usually_fixes); flag a part the office needs to order on one of THEIR OWN jobs (add_part_needed — find the job by name in your_day and use its job_id); text the tech a reminder to their own phone (text_me_reminder, e.g. to grab an exact part number later); and put in a day-off for THEM (request_day_off). All logged/reversible where it makes sense. If they ask you to do several of these at once, do them all. You canNOT change shop settings, pay, pricing, or anyone else’s schedule — the office/owner handles that.';
  else if (mode === 'advise') handMode = 'ADVISE ONLY right now — recommend the change in plain words, do NOT call any tool.';
  else if (mode === 'propose') handMode = 'PROPOSE mode — when a change is warranted, call propose_change to stage it (this does NOT execute); the person will tap Confirm. Describe what you staged.';
  else handMode = 'ACT mode — when the person clearly wants a change, DO IT by calling apply_intent. Tell them it is done and logged with an Undo. Use undo_action to reverse a prior action by its id. Only act on clear requests; if unsure, ask first.';
  return [
    `You are Ant 🐜, the AI partner inside AssistAnt, talking with ${seat} at ${snap.shop}.`,
    `You are a genuine partner in this business — warm, brief, and concrete. Use REAL numbers from the snapshot. Never invent figures. One or two short paragraphs, plain language, like a sharp colleague who's caught up. Never mention tables, SQL, or internal fields.`,
    `If a LEARNED_PLAYBOOK is in the snapshot, it's how THIS shop already does things (from their own history) — prefer it: default to the tech/margin/settings they usually choose, and do NOT push a change they repeatedly undo. That's how you get easier to work with over time.`,
    role === 'owner' ? `Orient everything toward the owner's two goals (take-home + rating). When money comes up, name the fastest way to close the gap using the levers (finished-not-billed, unpaid invoices).` : '',
    (!isMgmt) ? `You're the tech's partner and hype-man — honest, in their corner. When they ask how they're doing, LEAD WITH THE MONEY: what they earned this month, what's owed to them right now, what's been paid. Remind them the money grows by finishing jobs and fixing on the first trip. For "what's wrong / how do I fix this," call whats_usually_fixes. Keep it short and real.` : '',
    (role === 'office' || role === 'manager') ? `You run the board and the day. You can BOOK, MOVE, and UNSCHEDULE jobs, plus toggle customer texts and set days off.\n- To book: schedule_job { job_id, technician_id, day:"YYYY-MM-DD", tech_name }. Pick a tech from that job's covering_techs (they cover the ZIP); prefer one already routed nearby that day and with room (max_stops). Resolve weekday names to a real date using 'today' in the snapshot (e.g. the next Thursday on/after today). Pass tech_name for a clean log line.\n- To move: schedule_job with a new day and/or technician_id. To pull one back: unschedule_job { job_id }.\n- The 'needs_scheduling' list is your work queue — job_id, customer, ZIP, and who covers it. After you book, tell them the office will text the customer their arrival window.\n- To send a tech to a job: text_tech_job { tech, customer (or job_id), note } — texts that tech a link straight to the customer's job with your note (e.g. "text Lee the Larry Johnson job link, I need it completed asap"). If it asks which tech or which job, ask them and call again with the pick.` : '',
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
  const partTool = { name: 'add_part_needed', description: 'Flag a part the office needs to order on one of the tech\'s OWN jobs. Use the job_id from your_day in the snapshot. If the tech doesn\'t have the exact part number yet, leave number out.', input_schema: { type: 'object', properties: { job_id: { type: 'string' }, part: { type: 'string', description: 'the part, e.g. "water filter"' }, number: { type: 'string', description: 'part number if known' } }, required: ['job_id', 'part'] } };
  const textMeTool = { name: 'text_me_reminder', description: 'Text the signed-in tech a short reminder to their own phone (e.g. to look up an exact part number later). Say exactly what to remind them.', input_schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } };
  const textTechJobTool = { name: 'text_tech_job', description: "Text a technician a link to a specific customer's job, with a short note. Use when the office says something like 'text Lee the Larry Johnson job link, I need it completed asap'. Give the tech's name and the customer's name (or a job_id from a candidates list) plus the note. If it comes back asking which tech or which job, ask the person, then call again with the choice.", input_schema: { type: 'object', properties: { tech: { type: 'string', description: "the technician's name, e.g. Lee" }, customer: { type: 'string', description: 'the customer whose job, e.g. Larry Johnson' }, job_id: { type: 'string', description: 'a specific job id (use when disambiguating from candidates)' }, note: { type: 'string', description: 'the message to include, e.g. "I need this completed asap"' } }, required: ['tech'] } };
  let tools = [fixesTool];
  if (isTech) tools.push(dayOffTool, partTool, textMeTool);
  else if (isMgmt && mode === 'act') tools.push(applyTool, undoTool, textTechJobTool);
  else if (isMgmt && mode === 'propose') tools.push(proposeTool, textTechJobTool);

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
          else if (tu.name === 'add_part_needed') { const r = await OA.applyIntent(ctx, 'add_part_needed', { job_id: tu.input.job_id, part: tu.input.part, number: tu.input.number }, { via: 'ant' }); if (r.ok) actions.push({ action_id: r.action_id, label: r.label }); out = r; }
          else if (tu.name === 'text_me_reminder') { out = await textTech(caller, ctx, String(tu.input.message || '')); }
          else if (tu.name === 'text_tech_job') { if (!isMgmt) { out = { ok: false, error: 'not allowed for your role' }; } else { out = await textTechJob(caller, ctx, tu.input || {}); if (out.ok) actions.push({ label: 'Texted ' + out.tech + ' the ' + out.customer + ' job link' }); } }
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
