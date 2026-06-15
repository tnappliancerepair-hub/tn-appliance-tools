// tech-schedule-talk — the conversational scheduler brain. A tech talks to Ant
// like it's the office: "doctor's appointment Thursday the 26th 9 to 11",
// "can't work March 3rd, wife's birthday", "off the day before and after
// Christmas". Claude parses it into structured time-off, then writes it to the
// tech's availability so it shows on the office year calendar.
//
//   POST { tech_id, message }
//   -> { ok, reply, entries:[{date,full_day,start,end,reason}], written, failed }

'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

function ctNow() {
  // YYYY-MM-DD + weekday in America/Chicago, for relative-date parsing.
  const d = new Date();
  const date = d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const wd = d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long' });
  return { date, weekday: wd };
}

async function parse(message, today) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: 'scheduler AI not configured' };
  const sys =
    'You are the scheduling assistant for an appliance-repair company. A technician is telling you when they need time off. '
    + 'Convert their message into structured time-off entries. Today is ' + today.weekday + ', ' + today.date + ' (America/Chicago). '
    + 'Resolve relative dates ("Thursday the 26th", "next Monday", "day before Christmas", "Christmas Eve") to absolute YYYY-MM-DD using that as today. '
    + 'Holidays: Christmas = Dec 25, Christmas Eve = Dec 24, day after Christmas = Dec 26, New Year\'s = Jan 1, Thanksgiving = 4th Thursday of November. '
    + 'If they give a time window (e.g. "9 to 11", "from 9am-11", "morning"), set full_day=false and start/end in 24h HH:MM. '
    + 'If it is a whole day off (birthday, vacation, "can\'t work that day"), set full_day=true and leave start/end empty. '
    + 'A range ("off the 3rd through the 7th", "next week") becomes ONE entry per day. '
    + 'reason = a short human label (e.g. "doctor appointment", "wife\'s birthday", "vacation"). '
    + 'Respond with STRICT JSON only, no prose: '
    + '{"entries":[{"date":"YYYY-MM-DD","full_day":true|false,"start":"HH:MM|","end":"HH:MM|","reason":""}],'
    + '"reply":"a short friendly confirmation in your own words","needs_clarification":false,"clarify":""}. '
    + 'If you cannot tell the date, set needs_clarification=true, entries=[], and put a question in clarify.';
  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 900, system: sys, messages: [{ role: 'user', content: String(message || '') }] }),
    });
    const d = await r.json();
    const text = (((d || {}).content || [])[0] || {}).text || '';
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    return { error: 'could not understand that — try e.g. "off Thursday the 26th, 9 to 11, doctor"' };
  }
}

async function postXano(path, body) {
  const r = await fetch(`${XANO}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try { return await r.json(); } catch (_) { return { error: `HTTP ${r.status}` }; }
}

async function writeEntry(techId, e) {
  const reason = e.full_day ? (e.reason || 'time off')
    : ((e.reason || 'appointment') + (e.start ? (' ' + e.start + (e.end ? '-' + e.end : '')) : ''));
  if (e.full_day) {
    // whole day off
    const d = await postXano('tech_set_day_off', { technician_id: techId, date: e.date, off: true, reason });
    return !(d && d.error);
  }
  // partial window — a timed availability row (not a full day off) so the office
  // sees the commitment without losing the whole day's capacity.
  const d = await postXano('tech_availability', {
    technician_id: techId, blocked_date: e.date, start_time: e.start || '', end_time: e.end || '',
    reason, full_day_off: false,
  });
  return !(d && d.error);
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { b = {}; }
  const techId = parseInt(b.tech_id, 10);
  const message = String(b.message || '').trim();
  if (!techId) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'tech_id required' }) };
  if (!message) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'message required' }) };

  const parsed = await parse(message, ctNow());
  if (parsed.error) return { statusCode: 200, body: JSON.stringify({ ok: false, error: parsed.error }) };
  if (parsed.needs_clarification) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, reply: parsed.clarify || 'Which day did you mean?', entries: [], written: 0 }) };
  }
  const entries = Array.isArray(parsed.entries) ? parsed.entries.slice(0, 60) : [];
  let written = 0, failed = 0;
  for (const e of entries) {
    if (!e || !e.date) { failed++; continue; }
    const ok = await writeEntry(techId, e);
    if (ok) written++; else failed++;
  }
  // audit
  try {
    const tok = process.env.XANO_METADATA_TOKEN;
    if (tok) await fetch('https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/table/3/content', {
      method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'tech_scheduled_time_off', metadata: { tech_id: techId, message, entries, written, failed, at_ms: Date.now() } }),
    });
  } catch (_) {}

  const reply = parsed.reply || (written ? ('Done — marked ' + written + ' day' + (written === 1 ? '' : 's') + ' off.') : 'I couldn\'t save that — try again?');
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, reply, entries, written, failed }) };
};
