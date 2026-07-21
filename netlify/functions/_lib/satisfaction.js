// satisfaction — the "How'd we do?" gate. After a job completes we ask the
// customer 👍 / 👎 BEFORE asking for a public review:
//   👍 happy   -> send the Google review link (funnel happy customers public)
//   👎 unhappy -> ask "what could we have done better?" (capture privately +
//                 alert Teddy, so an unhappy customer is handled by a human
//                 instead of becoming a public 1-star)
//
// State lives in event_log as `satisfaction_state_<phone10>` rows; the latest
// row's metadata.stage drives behavior (awaiting_rating -> awaiting_feedback ->
// done). Pure Netlify (no Mac loop) so it's reliable + live immediately.
'use strict';
const crud = require('./xano/metadata-crud');
const { getSecret } = require('./secrets');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const REVIEW_URL = 'https://g.page/r/CRt-vo--eAJ3EBM/review';
const OWNER = '+16154855795';
const STALE_MS = 14 * 86400000; // ignore a state older than 14 days

// Nextdoor recommendation (compliant path): a REAL happy customer recommends us
// from their own account — no bot, no incentive. The claimed TN Appliance Exchange
// Nextdoor Business Page is the destination; a valid nextdoor.com URL in the vault
// (NEXTDOOR_RECOMMEND_URL) overrides the default.
const NEXTDOOR_URL = 'https://nextdoor.com/page/tn-appliance-exchange-antioch-tn';
async function nextdoorSuffix() {
  let url = '';
  try { url = String((await getSecret('NEXTDOOR_RECOMMEND_URL')) || '').trim(); } catch (_) { url = ''; }
  if (!/^https?:\/\/(www\.)?nextdoor\.com\//i.test(url)) url = NEXTDOOR_URL;
  return `\n\nOn Nextdoor? A quick recommendation to your neighbors helps just as much: ${url}`;
}

function d10(p) { return String(p || '').replace(/\D/g, '').slice(-10); }
function e164(p) { const d = String(p || '').replace(/\D/g, ''); if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; return d ? ('+' + d) : ''; }
function metaOf(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

async function sendCustomer(phone, msg, tag) {
  try { await fetch(`${XANO}/send_sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: e164(phone), message: msg, context_tag: tag || 'satisfaction' }), signal: AbortSignal.timeout(10000) }); } catch (_) {}
}
async function sendOwner(msg, tag) {
  try { await fetch(`${XANO}/send_sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: OWNER, message: msg, force_send: true, context_tag: tag || 'satisfaction_owner' }), signal: AbortSignal.timeout(10000) }); } catch (_) {}
}

// Classify a 👍/👎 reply. Emojis win; then keywords. Returns 'pos'|'neg'|'unclear'.
function classify(body) {
  const t = String(body || '').toLowerCase().trim();
  if (/👍|💯|🙏|❤|♥|⭐|🌟|🥰|😊|👏/.test(body) && !/👎/.test(body)) return 'pos';
  if (/👎|😡|😠|😞|💩/.test(body)) return 'neg';
  if (/\b(great|good|awesome|excellent|perfect|amazing|wonderful|happy|fantastic|love(d)?|best|5\s*star|five\s*star|yes+|yep|yup|thumbs?\s*up|all\s*good|nailed|satisfied|pleased)\b/.test(t)) return 'pos';
  if (/\b(bad|poor|terrible|awful|horrible|unhappy|disappointed|disappointing|not\s*(good|great|happy)|no+|nope|worst|never|rude|late|broke|broken|0\s*star|1\s*star|one\s*star|2\s*star|refund|cracked|damage)\b/.test(t)) return 'neg';
  if (t === '👍' || t === '5' || t === '👌') return 'pos';
  if (t === '👎' || t === '0' || t === '1') return 'neg';
  return 'unclear';
}

// Arm the gate: record awaiting_rating. Called by the request sweep.
// Carries tech/appliance/city so the review ask can name them — turning a generic
// "great service" review into "Lee fixed my dryer in Nashville" (richer trust + local rank).
async function arm(phone, ctx) {
  const ph = d10(phone); if (!ph) return false;
  try { await crud.logEvent('satisfaction_state_' + ph, { stage: 'awaiting_rating', job_id: (ctx && ctx.job_id) || null, cust_id: (ctx && ctx.cust_id) || null, first: (ctx && ctx.first) || '', tech: (ctx && ctx.tech) || '', appliance: (ctx && ctx.appliance) || '', city: (ctx && ctx.city) || '', at_ms: Date.now() }); return true; } catch (_) { return false; }
}

async function latestState(phone) {
  const ph = d10(phone); if (!ph) return null;
  let row = null;
  try { row = await crud.searchOne(crud.TABLES.event_log, { action: 'satisfaction_state_' + ph }, { id: 'desc' }); } catch (_) { return null; }
  if (!row) return null;
  const m = metaOf(row);
  const at = Number(m.at_ms || row.created_at || 0);
  if (!at || at < Date.now() - STALE_MS) return null;   // expired
  return { ph, stage: m.stage || '', job_id: m.job_id || null, first: m.first || '', tech: m.tech || '', appliance: m.appliance || '', city: m.city || '', at };
}

// Inbound interceptor. Returns {matched:true,...} when this text was a response
// to an active "How'd we do?" gate (and it has already replied/alerted), so the
// caller short-circuits the generic flow. Otherwise {matched:false}.
async function handleInbound(phone, body) {
  const st = await latestState(phone);
  if (!st) return { matched: false };
  const first = st.first || 'there';

  // Stage 2: we asked "what could we have done better?" — THIS text is the feedback.
  if (st.stage === 'awaiting_feedback') {
    const fb = String(body || '').trim();
    await sendOwner(`📝 Customer feedback (👎) from ${first}${st.job_id ? (' · job #' + st.job_id) : ''} (${d10(phone)}):\n"${fb.slice(0, 400)}"\n\nThey're expecting a personal follow-up.`, 'satisfaction_feedback');
    await sendCustomer(phone, `Thank you, ${first} — I've got this and I'll personally look into it. We want to make it right. — Teddy, TN Appliance`, 'satisfaction_feedback_ack');
    await crud.logEvent('satisfaction_state_' + st.ph, { stage: 'done', job_id: st.job_id, first, outcome: 'feedback_captured', at_ms: Date.now() });
    return { matched: true, stage: 'feedback_captured' };
  }

  // Stage 1: awaiting the 👍 / 👎.
  if (st.stage === 'awaiting_rating') {
    const c = classify(body);
    if (c === 'pos') {
      const nd = await nextdoorSuffix();
      const tech = String(st.tech || '').trim();
      const appl = String(st.appliance || '').trim().toLowerCase();
      const city = String(st.city || '').trim();
      // Opener names the tech + appliance when we know them (honest, specific).
      let opener;
      if (tech && appl) opener = `So glad ${tech} got your ${appl} sorted, ${first}! 🙏`;
      else if (tech) opener = `So glad ${tech} took good care of you, ${first}! 🙏`;
      else if (appl) opener = `So glad we got your ${appl} sorted, ${first}! 🙏`;
      else opener = `So glad to hear it, ${first}! 🙏`;
      // Gentle (non-incentivized) nudge to mention tech + city → richer, more findable reviews.
      const bits = [tech, city].filter(Boolean);
      const hint = bits.length ? ` — a mention of ${bits.join(' and ')} helps neighbors find us` : '';
      await sendCustomer(phone, `${opener} If you've got 30 seconds, a quick Google review would mean the world to our small team${hint}: ${REVIEW_URL}${nd}`, 'satisfaction_review_link');
      await crud.logEvent('satisfaction_state_' + st.ph, { stage: 'done', job_id: st.job_id, first, outcome: nd ? 'positive_review_link_g+nd' : 'positive_review_link', at_ms: Date.now() });
      return { matched: true, stage: 'positive' };
    }
    if (c === 'neg') {
      await sendCustomer(phone, `I'm sorry we didn't get it right, ${first}. What could we have done better? Your reply comes straight to me — I want to make it right. — Teddy, TN Appliance`, 'satisfaction_ask_feedback');
      await sendOwner(`👎 ${first}${st.job_id ? (' · job #' + st.job_id) : ''} (${d10(phone)}) was NOT happy — asked them what we could've done better. Their reply will come to you. Consider a personal call.`, 'satisfaction_negative');
      await crud.logEvent('satisfaction_state_' + st.ph, { stage: 'awaiting_feedback', job_id: st.job_id, first, at_ms: Date.now() });
      return { matched: true, stage: 'negative' };
    }
    // unclear — let the normal flow answer; the gate stays armed for a clear reply.
    return { matched: false, stage: 'unclear' };
  }

  return { matched: false };
}

module.exports = { arm, handleInbound, classify, REVIEW_URL };
