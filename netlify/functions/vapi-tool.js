// vapi-tool — single proxy between Vapi server-tools and our Xano endpoints.
//
// WHY: Vapi POSTs tool calls wrapped in {message:{toolCalls:[{id,function:
// {name,arguments}}]}} and expects {results:[{toolCallId,result}]} back. Our
// Xano endpoints take FLAT params and return flat JSON, so pointing a Vapi tool
// straight at Xano fails ("Missing param"). This proxy unwraps the envelope,
// calls Xano with the right verb/params, and returns Vapi's format. Point every
// POST-ish Vapi tool's server URL at this function.

'use strict';

const { sendSms } = require('./_lib/sms');
let sb = null; try { sb = require('./_lib/supabase'); } catch (_) {}
const OWNER_PHONE = '+16154855795';     // Teddy
const DANIELLE_PHONE = '+16154850713';
const SITE = 'https://tnapplianceexchange.net';

const XANO = (process.env.XANO_INTAKE_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA').replace(/\/+$/, '');
const NETLIFY = (process.env.NETLIFY_FUNCTIONS_BASE || 'https://tnapplianceexchange.net/.netlify/functions').replace(/\/+$/, '');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';

// Our own lines — never save one of these as a customer's number (a forwarded
// call used to show the shop's own number; defensive even now that's fixed).
const SHOP_DIGITS = new Set(['6152802949', '8662680111', '8882688998', '6158578800', '6155889500', '5043559111', '6292607111', '6292477111', '7315031142', '5043800975']);

// THE #1 DROPPED-CALL FIX: every backend call MUST return fast. With no timeout,
// a slow/hung Xano made the tool call hang forever → Vapi got no result → the
// caller sat in dead air until "silence-timed-out" (66% of inbound calls). Now
// we cap every lookup at TOOL_TIMEOUT_MS and, on any timeout/error, return a
// result that tells Ant to KEEP TALKING and take the caller's details — never
// freeze. (When Xano is healthy this never triggers; lookups return in ~0.1s.)
// 2026-06-22: cut from 8000 → 4500. 8s of dead air during a lookup was long
// enough that callers (and the assistant's own silence window) rolled into
// "silence-timed-out" — real customers + a warranty dispatch were lost that way.
// Xano lookups return in ~0.1s when healthy, so 4.5s still clears every real
// lookup; it only makes the keep-talking fallback fire sooner when Xano hangs.
// (The COMPLETE fix is a "one moment, let me pull that up" filler on the Vapi
// tools so Ant never goes silent during a lookup — that's a live-assistant
// change, applied separately.)
const TOOL_TIMEOUT_MS = 4500;
// Post-lookup audit/capture/alert writes hit the (flaky) metadata API. Cap how
// long they may block the tool response so they can never re-introduce silence.
const BOOKKEEPING_CAP_MS = 2500;
const SLOW_FALLBACK = {
  ok: false,
  lookup_unavailable: true,
  say: "I'm having a little trouble pulling that up this second — let me grab your details so we get you taken care of.",
  instruction: "The lookup backend did not respond in time. Do NOT go silent and do NOT end the call. Briefly apologize, then ask the caller for their name and the best callback number, confirm what they need, and log it with capture_callback so the office follows up right away.",
};
async function getJson(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TOOL_TIMEOUT_MS) });
    return await r.json();
  } catch (_) { return SLOW_FALLBACK; }
}
async function postJson(url, body) {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TOOL_TIMEOUT_MS) });
    return await r.json();
  } catch (_) { return SLOW_FALLBACK; }
}

// Tools that are GET on Xano (everything else is POST with the unwrapped args).
// Verified against the .xs endpoint method suffixes; everything else is POST.
const GET_TOOLS = new Set(['lookup_customer_by_phone', 'check_service_zone', 'get_parts_status', 'get_job_arrival_status']);
// Tool name -> Xano endpoint path when they differ.
const ENDPOINT_OVERRIDE = { start_new_intake: 'create_job_from_chat', submit_tech_tdr: 'create_tdr' };
// Tools that live on Netlify, not Xano. search_customers uses our forgiving
// search fn (substring/any-case/middle-name) instead of the brittle XS endpoint.
const NETLIFY_TOOLS = { capture_callback: 'capture-callback', search_customers: 'search-customers', message_for_tech: 'tech-message', get_tech_report_context: 'vapi-tech-report-context', get_my_open_reports: 'vapi-tech-open-reports', save_availability: 'set-job-availability', send_quickcheck_link: 'send-quickcheck-link', send_parts_link: 'parts-link' };

function qs(a) {
  const parts = Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

// Status tools answer from job-truth (the ONE job brain) so the phone speaks the
// EXACT same line as the portal / text / office / warranty lookup. Warranty rep
// gets the warranty lens; a homeowner gets the customer lens (already sanitized —
// no part numbers, dates only). This is the phone half of "one truth, every seat".
const STATUS_LENS = { get_job_status_for_warranty: 'warranty', get_job_arrival_status: 'customer', get_parts_status: 'customer' };
async function jobTruthAnswer(name, a) {
  const lens = STATUS_LENS[name];
  const q = { lens };
  const claim = a.claim_or_dispatch_number || a.claim_number || a.claim || a.dispatch_number || '';
  const phone = a.phone || a.phone_number || a.phone_e164 || a.customer_phone || '';
  if (claim) q.claim = claim; else if (a.job_id) q.job_id = a.job_id; else if (phone) q.phone = phone;
  const d = await getJson(`${NETLIFY}/job-truth${qs(q)}`);
  if (d && d.found) {
    const f = d.facts || {};
    // Only safe fields (part_eta is a DATE, never a part #). No internal notes.
    return { found: true, answer: (d.lenses && d.lenses[lens]) || '', status: f.status, scheduled_day: f.scheduled_day, part_eta: f.part_eta, tech: f.tech_name };
  }
  return { found: false, answer: (d && d.reason) || "I don't see that one in our system yet — I can take the details and have someone confirm." };
}

// Route a tool name + args to the right backend. Generic by default: unwrap the
// Vapi envelope and call Xano flat (POST), so EVERY tool the assistant has works
// without per-tool code. GET tools use query params; a couple have overrides.
async function callBackend(name, a) {
  a = a || {};
  if (!name) return { error: 'no tool name' };
  if (STATUS_LENS[name]) return jobTruthAnswer(name, a);
  if (NETLIFY_TOOLS[name]) return postJson(`${NETLIFY}/${NETLIFY_TOOLS[name]}`, a);
  const path = ENDPOINT_OVERRIDE[name] || name;
  if (GET_TOOLS.has(name)) return getJson(`${XANO}/${path}${qs(a)}`);
  return postJson(`${XANO}/${path}`, a);
}

// Shape sensitive read results down to what the assistant needs — and strip
// internal diagnosis notes so they never enter the LLM context (Teddy's rule:
// Ant never tells the customer what's wrong / part numbers).
function stripInternal(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripInternal);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'notes_internal' || k === 'problem_description' || k === 'problem_summary' || k === 'notes') continue;
    out[k] = (v && typeof v === 'object') ? stripInternal(v) : v;
  }
  return out;
}

function shapeResult(name, data) {
  if (!data || typeof data !== 'object') return data;
  if (name === 'lookup_by_claim_number') {
    return { found: (data.match_count || 0) > 0, match_count: data.match_count || 0, primary: data.primary || null };
  }
  if (name === 'lookup_customer_by_phone') {
    const c = data.customer || {};
    return {
      found: !!data.found,
      caller_id_masked: !!data.caller_id_masked,
      hint: data.hint || '',
      customer_first_name: c.first_name || '',
      open_jobs: Array.isArray(data.open_jobs) ? data.open_jobs.map(stripInternal) : [],
      recent_jobs: Array.isArray(data.recent_jobs) ? data.recent_jobs.map(stripInternal) : [],
      last_call_summary: data.last_call_summary || '',
    };
  }
  if (name === 'search_customers') {
    return { match_count: data.match_count || (Array.isArray(data.matches) ? data.matches.length : 0), matches: stripInternal(data.matches || data.results || []) };
  }
  return stripInternal(data);
}

// Extract [{id, name, args}] from whatever shape Vapi sends.
function parseToolCalls(body) {
  const m = (body && body.message) || body || {};
  if (Array.isArray(m.toolCallList)) {
    return m.toolCallList.map((tc) => ({ id: tc.id, name: tc.name || (tc.function && tc.function.name), args: tc.arguments || (tc.function && tc.function.arguments) }));
  }
  if (Array.isArray(m.toolCalls)) {
    return m.toolCalls.map((tc) => ({ id: tc.id, name: tc.function && tc.function.name, args: tc.function && tc.function.arguments }));
  }
  if (Array.isArray(body && body.toolCalls)) {
    return body.toolCalls.map((tc) => ({ id: tc.id, name: tc.function && tc.function.name, args: tc.function && tc.function.arguments }));
  }
  // flat fallback (someone POSTs args directly)
  return [{ id: (body && body.id) || 'call_1', name: body && body.name, args: (body && body.arguments) || body }];
}

function coerceArgs(args) {
  if (!args) return {};
  if (typeof args === 'string') { try { return JSON.parse(args); } catch (_) { return {}; } }
  return args;
}

// Fire-and-forget visibility: log every proxy call + whether it found anything,
// with the outcome baked into the action name so get_event_log_by_action can
// read it (that endpoint returns only action+last_at, not metadata).
async function logProxy(name, args, data) {
  const tok = process.env.XANO_METADATA_TOKEN;
  if (!tok) return;
  let found = false;
  if (data && typeof data === 'object') {
    if (typeof data.match_count === 'number') found = data.match_count > 0;
    else if (typeof data.found === 'boolean') found = data.found;
    else if (data.primary || (Array.isArray(data.results) && data.results.length)) found = true;
    else if (data.success === true && !data.error) found = true;
  }
  const action = `vapi_proxy_${name}_${found ? 'found' : 'empty'}`;
  try {
    await fetch('https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/table/3/content', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, metadata: { name, args, found, at_ms: Date.now() } }),
      signal: AbortSignal.timeout(BOOKKEEPING_CAP_MS),
    });
  } catch (_) {}
}

// The caller's real number, dug out of whatever shape Vapi sends.
function callerNumberFrom(body) {
  const m = (body && body.message) || {};
  return (m.call && m.call.customer && m.call.customer.number)
    || (m.customer && m.customer.number)
    || (body && body.call && body.call.customer && body.call.customer.number)
    || '';
}

// Learn the caller's number: when Ant resolves someone by CLAIM # (their phone
// wasn't on file), save that number onto the customer record IF it's empty — so
// next time they call, lookup_customer_by_phone matches them by name. Never
// overwrites an existing number; only fills the blank warranty records. Best
// effort — wrapped so it can never break the tool response.
async function captureCallerPhone(callerPhone, name, data) {
  try {
    const tok = process.env.XANO_METADATA_TOKEN;
    if (!tok) return;
    if (name !== 'lookup_by_claim_number') return;
    if (!data || (data.match_count || 0) !== 1 || !data.primary || !data.primary.job_id) return;
    const digits = String(callerPhone || '').replace(/\D/g, '').slice(-10);
    if (digits.length !== 10 || SHOP_DIGITS.has(digits)) return;
    const h = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
    // job -> customer_id
    const job = await (await fetch(`${META}/table/7/content/${data.primary.job_id}`, { headers: h })).json().catch(() => ({}));
    const cid = job && job.customer_id;
    if (!cid) return;
    const cust = await (await fetch(`${META}/table/6/content/${cid}`, { headers: h })).json().catch(() => ({}));
    const existing = String((cust && cust.phone) || '').replace(/\D/g, '');
    if (existing.length >= 10) return; // already has a number — leave it
    await fetch(`${META}/table/6/content/${cid}`, { method: 'PUT', headers: h, body: JSON.stringify({ phone: callerPhone }) });
    await fetch(`${META}/table/3/content`, { method: 'POST', headers: h, body: JSON.stringify({ action: 'caller_phone_captured', metadata: { customer_id: cid, job_id: data.primary.job_id, phone: callerPhone, at_ms: Date.now() } }) });
  } catch (_) {}
}

// When a call creates a job/ticket (esp. a CALLBACK on a failed repair), text
// BOTH Teddy and Danielle the customer info + a link so it never gets missed.
async function alertNewJob(name, args, data) {
  if (name !== 'create_job_from_call') return;
  if (!data || !data.success || !data.job_id) return;
  try {
    const who = [args.customer_first_name, args.customer_last_name].filter(Boolean).join(' ') || '(caller)';
    const summ = String(args.problem_summary || '').slice(0, 150);
    const isCb = /callback/i.test(args.problem_summary || '');
    const link = `${SITE}/office-board.html?job=${data.job_id}`;
    const msg = '[ant] ' + (isCb ? '📞 CALLBACK' : '🆕 new job') + ' from a call: ' + who + ' ' + (args.customer_phone || '')
      + (args.appliance_type ? (' · ' + args.appliance_type) : '') + ' — ' + summ
      + '  Job #' + data.job_id + ' (Needs Scheduled): ' + link;
    await sendSms(OWNER_PHONE, msg, 'owner', 'vapi_new_job').catch(() => {});
    await sendSms(DANIELLE_PHONE, msg, 'warranty_handler', 'vapi_new_job').catch(() => {});
  } catch (_) {}
}

// HCP BRIDGE (interim — until everything's on Ant). If Xano doesn't know the
// caller, check the HCP archive (Supabase) by phone so Ant still recognizes them
// and can recall past service. Fast (indexed phone10/cust_id), bounded, never throws.
async function hcpEnrich(callerPhone, shaped) {
  try {
    if (!sb) return shaped;
    const digits = String(callerPhone || '').replace(/\D/g, '').slice(-10);
    if (digits.length !== 10 || SHOP_DIGITS.has(digits)) return shaped;
    const custs = await sb.select('hcp_archive', { kind: 'eq.customer', phone10: 'eq.' + digits, limit: 1 });
    const cust = custs && custs[0];
    if (!cust) return shaped;
    const c = cust.data || {};
    const first = c.first_name || String(c.company || '').split(' ')[0] || '';
    const cid = String(cust.hcp_id || c.id || '');
    let jobs = [];
    if (cid) { try { jobs = await sb.select('hcp_archive', { kind: 'eq.job', cust_id: 'eq.' + cid, order: 'id.desc', limit: 3, select: 'd:data->>description,ws:data->>work_status,bal:data->>outstanding_balance' }); } catch (_) {} }
    const cents = (x) => Number(String(x == null ? '' : x).replace(/[^0-9.\-]/g, '')) || 0;
    const history = (jobs || []).map((j) => ({ what: String(j.d || '').slice(0, 80), status: j.ws || '' }));
    const owed = (jobs || []).reduce((s, j) => s + cents(j.bal), 0);
    return {
      ...shaped,
      found: true,
      source: 'hcp_history',
      from_past_records: true,
      customer_first_name: shaped.customer_first_name || first,
      hcp_history: history,
      past_balance: owed > 0 ? '$' + (owed / 100).toFixed(2) : '$0.00',
      note: 'Recognized from our PAST (Housecall Pro) records — not a current Ant job. Greet by name + recall past service; confirm details for anything current.',
    };
  } catch (_) { return shaped; }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let body; try { body = JSON.parse(event.body || '{}'); } catch (_) { body = {}; }

  const callerPhone = callerNumberFrom(body);
  const calls = parseToolCalls(body);
  const results = [];
  for (const c of calls) {
    const a = coerceArgs(c.args);
    // send_parts_link: text the diagram link to the tech she's ON THE PHONE with,
    // so the assistant never has to know his number — just his model + brand.
    if (c.name === 'send_parts_link' && !a.phone && !a.tech_phone && !a.to && callerPhone) a.tech_phone = callerPhone;
    // We KNOW the caller's number — they're calling us. Always look them up by the
    // REAL caller ID, never by whatever the model mis-heard or left blank. (The
    // lookup itself flags a masked/shop number, so this is safe.)
    if (c.name === 'lookup_customer_by_phone' && callerPhone) a.phone = callerPhone;
    let data;
    try { data = await callBackend(c.name, a); }
    catch (e) { data = { error: String((e && e.message) || e) }; }
    // Shape + push the caller's answer FIRST so the tool response is ready the
    // instant the lookup returns. The bookkeeping below talks to the flaky Xano
    // metadata API — it must never delay (or silence) the call.
    let shaped = shapeResult(c.name, data);
    // HCP bridge: caller unknown to Xano? fall back to the HCP archive (bounded so
    // it can never hang the call — returns the original result if it's slow).
    if (c.name === 'lookup_customer_by_phone' && shaped && !shaped.found) {
      shaped = await Promise.race([
        hcpEnrich(callerPhone || a.phone || a.phone_number || a.phone_e164, shaped),
        new Promise((r) => setTimeout(() => r(shaped), 2500)),
      ]);
    }
    results.push({ toolCallId: c.id, result: typeof shaped === 'string' ? shaped : JSON.stringify(shaped) });
    // Best-effort audit/capture/alert, hard-bounded. A slow or hung metadata API
    // can't add more than BOOKKEEPING_CAP_MS to the tool response (this is the
    // other half of the silence-timeout fix — the lookup timeout alone wasn't
    // enough because these awaited metadata writes sat in the hot path too).
    await Promise.race([
      Promise.all([
        logProxy(c.name || 'unknown', a, data),
        captureCallerPhone(callerPhone, c.name, data),
        alertNewJob(c.name, a, data),
      ]).catch(() => {}),
      new Promise((r) => setTimeout(r, BOOKKEEPING_CAP_MS)),
    ]);
  }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results }) };
};
