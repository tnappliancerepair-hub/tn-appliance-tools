// schedule-move — "ask the customer BEFORE we move their appointment" consent gate
// (Teddy 2026-08-11: as Danielle re-works routes, customers were getting moved without
// being told — furious customers. His fix: the system asks the customer first, only
// applies the move if they say YES, leaves them put if they decline or don't reply, and
// keeps a physical record that they approved).
//
// Flow (mirrors _lib/satisfaction.js — pure Netlify, no Mac loop, reliable + live now):
//   propose(ctx)  -> records an 'awaiting_ok' consent state + texts the customer the ask.
//                    Does NOT move the job.
//   customer YES  -> applies the move (same danielle_schedule_parallel_job the board uses),
//                    logs schedule_move_approved (the record), confirms, alerts Danielle.
//   customer NO   -> keeps their current day, logs schedule_move_declined, flags Danielle.
//   no reply      -> nothing changes (state goes stale after 10 days).
//
// State lives in event_log as `sched_move_state_<phone10>` rows; the latest row's
// metadata.stage drives behavior. Durable audit rows: schedule_move_proposed /
// _approved / _declined (board surfacing + the CYA record).
'use strict';
const crud = require('./xano/metadata-crud');
const { sendSms } = require('./sms');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER = '+16154855795';
const STALE_MS = 10 * 86400000; // a proposal older than 10 days is dead

function d10(p) { return String(p || '').replace(/\D/g, '').slice(-10); }
function e164(p) { const d = String(p || '').replace(/\D/g, ''); if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; return d ? ('+' + d) : ''; }
function metaOf(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

async function sendCustomer(phone, msg, tag) { try { await sendSms(e164(phone), msg, 'customer', tag || 'schedule_move'); } catch (_) {} }
async function sendOwner(msg, tag) { try { await fetch(`${XANO}/send_sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: OWNER, message: msg, force_send: true, context_tag: tag || 'schedule_move_owner' }), signal: AbortSignal.timeout(10000) }); } catch (_) {} }

// YES = clearly accepts the new day. NO = clearly rejects. Anything else = unclear
// (we do NOT move on unclear — the safe default is to leave them where they are).
function classify(body) {
  const t = String(body || '').toLowerCase().trim();
  if (/👍|👌|✅|🙏/.test(body)) return 'yes';
  // affirmatives first so "no problem" / "works" resolve to yes, not no
  if (/\b(yes+|yep|yup|yeah|ya|sure|okay|ok|kay|works?|works for me|that works|sounds good|good to go|fine|perfect|great|no problem|thats? fine|thats? ok|go ahead|do it|confirm(ed)?)\b/.test(t)) return 'yes';
  if (/👎/.test(body)) return 'no';
  if (/\b(no+|nope|nah|can'?t|cannot|won'?t|wont|unable|doesn'?t work|does not work|not work|not good|bad time|different|another (day|time)|reschedul)\b/.test(t)) return 'no';
  return 'unclear';
}

// Record the pending consent + text the customer. Does NOT move the job.
// ctx: { phone, job_id, cust_id, first, appliance, tech_id, tech_first,
//        from_start_ms, to_start_ms, to_day_label, by }
async function propose(ctx) {
  const ph = d10(ctx.phone); if (!ph) return { ok: false, error: 'no_phone' };
  const first = ctx.first || 'there';
  const appl = String(ctx.appliance || '').trim().toLowerCase();
  const day = ctx.to_day_label || 'a new day';
  const state = { stage: 'awaiting_ok', job_id: ctx.job_id || null, cust_id: ctx.cust_id || null, first, appliance: ctx.appliance || '', tech_id: Number(ctx.tech_id || 0), tech_first: ctx.tech_first || '', from_start_ms: Number(ctx.from_start_ms || 0), to_start_ms: Number(ctx.to_start_ms || 0), to_day_label: day, by: ctx.by || 'office', at_ms: Date.now() };
  try { await crud.logEvent('sched_move_state_' + ph, state); } catch (_) {}
  try { await crud.logEvent('schedule_move_proposed', Object.assign({ phone: ph }, state)); } catch (_) {}
  const msg = `Hi ${first} — it's TN Appliance Exchange. We'd like to move your${appl ? (' ' + appl) : ''} repair to ${day}. Reply YES if that works for you, or tell us what does. If we don't hear back, we'll keep your current day. Thank you!`;
  await sendCustomer(ctx.phone, msg, 'schedule_move_ask');
  return { ok: true, sent: true, day };
}

async function latestState(phone) {
  const ph = d10(phone); if (!ph) return null;
  let row = null;
  try { row = await crud.searchOne(crud.TABLES.event_log, { action: 'sched_move_state_' + ph }, { id: 'desc' }); } catch (_) { return null; }
  if (!row) return null;
  const m = metaOf(row);
  const at = Number(m.at_ms || row.created_at || 0);
  if (!at || at < Date.now() - STALE_MS) return null;
  return { ph, stage: m.stage || '', job_id: m.job_id || null, cust_id: m.cust_id || null, first: m.first || '', appliance: m.appliance || '', tech_id: Number(m.tech_id || 0), tech_first: m.tech_first || '', from_start_ms: Number(m.from_start_ms || 0), to_start_ms: Number(m.to_start_ms || 0), to_day_label: m.to_day_label || 'the new day', at };
}

// Apply the move via the SAME endpoint the office board uses (danielle_schedule_parallel_job).
async function applyMove(st) {
  try {
    const r = await fetch(`${XANO}/danielle_schedule_parallel_job`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: Number(st.job_id), technician_id: Number(st.tech_id) || 0, scheduled_start_ms: Number(st.to_start_ms) }), signal: AbortSignal.timeout(12000) });
    const d = await r.json().catch(() => ({}));
    if (d && (d.error || d.terminal_locked)) return { ok: false, err: d.error || 'locked' };
    return { ok: true };
  } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
}

// Inbound interceptor. Returns { matched:true } when this text was a reply to an active
// move proposal (already handled — reply/alert sent). Otherwise { matched:false }.
async function handleInbound(phone, body) {
  const st = await latestState(phone);
  if (!st || st.stage !== 'awaiting_ok') return { matched: false };
  const first = st.first || 'there';
  const day = st.to_day_label;
  const reply = String(body || '').slice(0, 300);
  const c = classify(body);

  if (c === 'yes') {
    const rec = (outcome, applied) => crud.logEvent('schedule_move_approved', { job_id: st.job_id, cust_id: st.cust_id, phone: st.ph, first, from_start_ms: st.from_start_ms, to_start_ms: st.to_start_ms, to_day_label: day, reply, applied: !!applied, at_ms: Date.now() });
    const done = (outcome) => crud.logEvent('sched_move_state_' + st.ph, { stage: 'done', job_id: st.job_id, outcome, at_ms: Date.now() });
    const confirm = () => sendCustomer(phone, `Perfect — thank you ${first}! You're all set for ${day}. We'll text you your arrival window that morning.`, 'schedule_move_confirm');
    if (!st.tech_id) {
      try { await done('approved_no_tech'); await rec('approved_no_tech', false); } catch (_) {}
      await confirm();
      await sendOwner(`✅ ${first} APPROVED moving job #${st.job_id} to ${day} — but the job has no tech assigned. Set ${day} + a tech on the board. (They said: "${reply.slice(0, 120)}")`, 'schedule_move_owner');
      return { matched: true, stage: 'approved_no_tech' };
    }
    const ap = await applyMove(st);
    try { await done(ap.ok ? 'approved_applied' : 'approved_apply_failed'); await rec('approved', ap.ok); } catch (_) {}
    await confirm();
    if (ap.ok) await sendOwner(`✅ ${first} approved + we moved job #${st.job_id} to ${day}. (They said: "${reply.slice(0, 120)}")`, 'schedule_move_owner');
    else await sendOwner(`✅ ${first} approved moving job #${st.job_id} to ${day} — but the auto-move didn't land (${ap.err}). Set ${day} on the board manually.`, 'schedule_move_owner');
    return { matched: true, stage: ap.ok ? 'approved_applied' : 'approved_apply_failed' };
  }

  if (c === 'no') {
    try { await crud.logEvent('sched_move_state_' + st.ph, { stage: 'done', job_id: st.job_id, outcome: 'declined', at_ms: Date.now() }); } catch (_) {}
    try { await crud.logEvent('schedule_move_declined', { job_id: st.job_id, cust_id: st.cust_id, phone: st.ph, first, to_day_label: day, reply, at_ms: Date.now() }); } catch (_) {}
    await sendCustomer(phone, `No problem, ${first} — we'll keep your current day. If you'd like a different time, just reply here and we'll find one that works.`, 'schedule_move_declined_ack');
    await sendOwner(`⚠️ ${first} said the new day (${day}) WON'T work for job #${st.job_id} — kept their current day. They said: "${reply.slice(0, 200)}". Follow up.`, 'schedule_move_owner');
    return { matched: true, stage: 'declined' };
  }

  // unclear — don't move; let the normal flow answer. The proposal stays open for a
  // clear YES/NO (their message still lands in the office thread).
  return { matched: false, stage: 'unclear' };
}

module.exports = { propose, handleInbound, classify, latestState };
