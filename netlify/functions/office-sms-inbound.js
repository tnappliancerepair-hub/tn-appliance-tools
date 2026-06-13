// Office-direction inbound SMS — lets Danielle (and other office numbers) just
// TEXT Ant what they need and have Ant do it + reply, as Ant. Dispatched from
// tech-sms-inbound when the sender is a known office number (so no extra Telnyx
// wiring — it reuses the already-live messaging webhook).
//
// from office number -> /office-assist parses intent -> we run it against the
// same Xano endpoints the board/widget use -> reply via Telnyx as Ant.

'use strict';

const SITE = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://tnapplianceexchange.net';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;

// Office senders routed to the assistant (NOT techs — Teddy stays on tech flow).
const OFFICE = { '6154850713': 'Danielle' };
const TECH_ID_BY_NAME = { teddy: 1, jimmy: 2, andre: 3, lee: 4, billy: 5, john: 6 };
const FOLDER = { follow_up: 'Follow Up', needs_invoice: 'Needs Invoice', waiting_parts: 'Waiting Parts', completed: 'Completion', needs_scheduled: 'Needs Scheduled' };

function bare(p) { return (p || '').replace(/\D/g, '').slice(-10); }
function isOffice(from) { return !!OFFICE[bare(from)]; }
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

function metaHeaders() {
  const t = process.env.XANO_METADATA_TOKEN;
  return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null;
}
function metaOf(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
async function logRow(action, metadata) {
  const h = metaHeaders(); if (!h) return;
  try { await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, { method: 'POST', headers: h, body: JSON.stringify({ action, metadata }) }); } catch (_) {}
}
async function isFirstContact(fromBare) {
  const h = metaHeaders(); if (!h) return false;
  try {
    const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content/search`, {
      method: 'POST', headers: h, body: JSON.stringify({ search: { action: 'office_sms_in' }, sort: { created_at: 'desc' }, per_page: 200, page: 1 }),
    });
    if (!r.ok) return false;
    const d = await r.json();
    return !((d && d.items) || []).some((x) => bare(metaOf(x).from) === fromBare);
  } catch (_) { return false; }
}
async function postJSON(ep, body) {
  try { const r = await fetch(XANO + '/' + ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.json(); } catch (_) { return {}; }
}
async function searchJobs(q) {
  try {
    const r = await fetch(XANO + '/office_universal_search?q=' + encodeURIComponent(q), { cache: 'no-store' });
    const d = await r.json();
    return ((d && d.items) || []).map((x) => ({ job_id: x.job_id || x.id, name: ((x.customer_first || '') + ' ' + (x.customer_last || '')).trim() || 'Customer' })).filter((x) => x.job_id);
  } catch (_) { return []; }
}
async function sendSms(from, to, text) {
  const key = process.env.TELNYX_API_KEY; if (!key) return;
  try {
    await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, text }),
    });
  } catch (_) {}
}

// Free-form help: answer Danielle's questions (and read photos she sends) as Ant.
async function antAnswer(text, mediaUrls) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const sys =
    "You are Ant, the friendly assistant for TN Appliance Exchange's office (you're texting Danielle). " +
    "Help her use the Ant system and answer her questions clearly and warmly, in 1-3 short sentences fit for a text message. " +
    "She schedules jobs at needs-scheduled.html (tap Schedule -> pick tech -> pick day), and can tell you to schedule/assign/mark parts in by text. " +
    "If she sent a photo, look at it and tell her what it is / what to do. If you're unsure or it needs Teddy, say so and tell her to text Teddy. Never make up part numbers. Sign off naturally, don't be robotic.";
  const content = [];
  (mediaUrls || []).slice(0, 4).forEach((u) => { if (u) content.push({ type: 'image', source: { type: 'url', url: u } }); });
  content.push({ type: 'text', text: text || (content.length ? 'What is this / what should I do?' : 'Hi') });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 350, system: sys, messages: [{ role: 'user', content }] }),
    });
    const d = await r.json();
    const t = d && d.content && d.content[0] && d.content[0].text;
    return t ? String(t).trim() : null;
  } catch (_) { return null; }
}

async function decide(p) {
  if (!p || !p.intent || p.intent === 'none') return p && p.reply ? p.reply : 'Tell me what you need — like "schedule the Carson job with Jimmy Thursday" or "the Davis job parts came in."';
  const ref = (p.job_ref || '').trim();
  let jobId = null, label = '';
  if (/^\d+$/.test(ref)) { jobId = parseInt(ref, 10); label = '#' + ref; }
  else if (ref) {
    const res = await searchJobs(ref);
    if (!res.length) return 'I couldn\'t find a job for "' + ref + '". Try the job # or the customer\'s name.';
    if (res.length > 1) return 'Which one? ' + res.slice(0, 4).map((r) => '#' + r.job_id + ' ' + r.name).join(' · ');
    jobId = res[0].job_id; label = res[0].name || ('#' + jobId);
  } else return 'Which job?';

  if (p.intent === 'assign') {
    const tid = TECH_ID_BY_NAME[(p.target || '').toLowerCase()];
    if (!tid) return 'Which tech should I assign to ' + label + '?';
    const d = await postJSON('reassign_job', { job_id: jobId, technician_id: tid });
    return (d && d.success) ? ('✅ Assigned ' + cap(p.target) + ' to ' + label + '.') : '⚠ That didn\'t go through — try again or do it on the board.';
  }
  if (p.intent === 'schedule') {
    const d = await postJSON('enqueue_scheduling_queue_propose', { job_id: jobId, source: 'office_sms' });
    return (d && d.success) ? ('✅ ' + label + ' queued to auto-schedule — slot options are on the way.') : '⚠ That didn\'t go through — try the Schedule button.';
  }
  if (p.intent === 'parts_arrived') {
    const d = await postJSON('mark_parts_arrived', { job_id: jobId, source: 'office_sms', notes: 'marked in via Ant text' });
    return (d && d.success) ? ('✅ Marked parts in for ' + label + ' — it\'s back in Needs Scheduled.') : '⚠ That didn\'t go through.';
  }
  if (p.intent === 'move') {
    const sm = { waiting_parts: 'awaiting_parts', completed: 'completed', needs_scheduled: 'not_ready' }; const st = sm[p.target];
    if (!st) return 'Where should ' + label + ' go?';
    const d = await postJSON('office_set_job_status', { job_id: jobId, scheduling_status: st, actor: 'Danielle (Ant text)' });
    return (d && d.success) ? ('✅ ' + label + ' → ' + (FOLDER[p.target] || p.target) + '.') : '⚠ That didn\'t go through.';
  }
  if (p.intent === 'search') return label + ' (job #' + jobId + '). Open it: ' + SITE + '/job-detail.html?job_id=' + jobId + '&office=1';
  if (p.intent === 'labor' || p.intent === 'invoice') return 'For invoicing, open ' + label + ' on the board: ' + SITE + '/office-board.html?job=' + jobId;
  return p.reply || ('Got it for ' + label + '.');
}

// Called by tech-sms-inbound with the already-parsed {from,to,body}.
async function handleParsed(parsed) {
  const fromBare = bare(parsed.from);
  const who = OFFICE[fromBare] || 'there';
  const media = parsed.media_urls || parsed.media || [];
  const hasMedia = Array.isArray(media) && media.length > 0;

  let p = {};
  if (!hasMedia) {
    try {
      const r = await fetch(`${SITE}/.netlify/functions/office-assist`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: parsed.body || '' }) });
      p = await r.json();
    } catch (_) { p = {}; }
  }

  const ACTIONS = { assign: 1, schedule: 1, parts_arrived: 1, move: 1, search: 1 };
  let reply;
  if (hasMedia || !p.intent || !ACTIONS[p.intent]) {
    // A photo or a free-form question -> let Ant help directly.
    reply = await antAnswer(parsed.body || '', media);
    if (!reply) reply = await decide(p); // fall back to the action path / prompt
  } else {
    reply = await decide(p);
  }
  if (await isFirstContact(fromBare)) {
    reply = 'Hi ' + who + ' — it\'s Ant 🐜. Just text me whatever you need (schedule a job, assign a tech, "parts came in") and I\'ll handle it. ' + reply;
  }

  // Reply as Ant, from the same line they texted.
  await sendSms(parsed.to || '+16158578800', parsed.from, reply);
  await logRow('office_sms_in', { from: parsed.from, who, body: (parsed.body || '').slice(0, 240), intent: (p && p.intent) || 'none', at_ms: Date.now() });
  await logRow('office_sms_reply', { to: parsed.from, who, reply: reply.slice(0, 300), at_ms: Date.now() });
  return { statusCode: 200, body: '' };
}

module.exports = { isOffice, handleParsed, OFFICE };
