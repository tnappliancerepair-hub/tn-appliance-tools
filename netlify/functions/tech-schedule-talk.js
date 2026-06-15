// tech-schedule-talk — the conversational scheduler brain. A tech talks to Ant
// like it's the office. Two things it captures:
//   1) TIME OFF / appointments  -> tech_availability (shows on the office calendar)
//      "doctor's appointment Thursday the 26th 9 to 11", "off March 3rd, wife's birthday"
//   2) PREFERENCES / "great day" -> the tech profile (feeds routing)
//      "I like to start at 6", "I don't work Wednesdays", "a great day is running
//      Baton Rouge and everything on the way", "don't put Hendersonville and
//      Murfreesboro on the same day", "I don't do Bosch"
//
//   POST { tech_id, message } -> { ok, reply, time_off, profile_updated }

'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const TECH_TABLE = 15;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

function ctNow() {
  const d = new Date();
  return {
    date: d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }),
    weekday: d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long' }),
  };
}
function metaHeaders() {
  const t = process.env.XANO_METADATA_TOKEN;
  return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null;
}

async function parse(message, today) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: 'scheduler AI not configured' };
  const sys =
    'You are the scheduling assistant for an appliance-repair company, talking to a technician. '
    + 'Today is ' + today.weekday + ', ' + today.date + ' (America/Chicago). '
    + 'Read their message and capture TWO kinds of things:\n'
    + '1) TIME OFF or appointments -> "time_off" entries. Resolve relative dates ("Thursday the 26th", '
    + '"day before Christmas"=Dec 24, "day after Christmas"=Dec 26) to YYYY-MM-DD. A window ("9 to 11") => '
    + 'full_day=false with start/end in 24h HH:MM; a whole day (birthday, vacation, "can\'t work that day") => '
    + 'full_day=true. A range becomes one entry per day.\n'
    + '2) PREFERENCES about how they like to work -> "profile". Capture only what they mention:\n'
    + '   - preferred_hours_start / preferred_hours_end (HH:MM) when they say what time they like to start/finish\n'
    + '   - days_off: array of weekday abbreviations (Sun,Mon,Tue,Wed,Thu,Fri,Sat) they regularly DON\'T work\n'
    + '   - route_preferences: a short summary IN THEIR WORDS of what a good day looks like / how they like to '
    + 'cluster areas / directions (e.g. "Likes to run Baton Rouge and everything on the way; or start in Slidell '
    + 'and work back home toward Walker. Don\'t mix Hendersonville, Lebanon and Murfreesboro in one day.")\n'
    + '   - brand_exclusions: brands they won\'t service (comma string)\n'
    + '   - max_stops_per_day: integer if stated\n'
    + 'If you asked them "what does a great day look like" and they answer, that answer is route_preferences. '
    + 'Respond with STRICT JSON only, no prose: '
    + '{"time_off":[{"date":"YYYY-MM-DD","full_day":true,"start":"","end":"","reason":""}],'
    + '"profile":{"preferred_hours_start":"","preferred_hours_end":"","days_off":[],"route_preferences":"",'
    + '"brand_exclusions":"","max_stops_per_day":null},'
    + '"reply":"a short friendly confirmation in your own words"}. '
    + 'Omit profile keys they did not mention. Empty time_off if none.';
  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1100, system: sys, messages: [{ role: 'user', content: String(message || '') }] }),
    });
    const d = await r.json();
    const text = (((d || {}).content || [])[0] || {}).text || '';
    return JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
  } catch (e) {
    return { error: 'could not understand that — try again' };
  }
}

async function postXano(path, body) {
  const r = await fetch(`${XANO}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try { return await r.json(); } catch (_) { return { error: `HTTP ${r.status}` }; }
}

async function writeTimeOff(techId, e) {
  const reason = e.full_day ? (e.reason || 'time off')
    : ((e.reason || 'appointment') + (e.start ? (' ' + e.start + (e.end ? '-' + e.end : '')) : ''));
  if (e.full_day) { const d = await postXano('tech_set_day_off', { technician_id: techId, date: e.date, off: true, reason }); return !(d && d.error); }
  const d = await postXano('tech_availability', { technician_id: techId, blocked_date: e.date, start_time: e.start || '', end_time: e.end || '', reason, full_day_off: false });
  return !(d && d.error);
}

// days off + the human note live inside personal_context: "OFF_DAYS=Wed;;note"
function buildContext(days, note) { const d = (days || []).join(','); return (!d && !note) ? '' : ('OFF_DAYS=' + d + ';;' + (note || '')); }
function parseContext(ctx) { ctx = ctx || ''; const m = ctx.match(/OFF_DAYS=([^;]*);;?(.*)$/s); return m ? { days: (m[1] || '').split(',').map(s => s.trim()).filter(Boolean), note: (m[2] || '').trim() } : { days: [], note: ctx }; }

async function updateProfile(techId, p) {
  const h = metaHeaders();
  if (!h) return { ok: false, fields: [] };
  // read current row (for personal_context merge)
  let cur = {};
  try { cur = await (await fetch(`${META}/table/${TECH_TABLE}/content/${techId}`, { headers: h })).json(); } catch (_) {}
  const partial = {}; const fields = [];
  if (p.preferred_hours_start) { partial.preferred_hours_start = String(p.preferred_hours_start); fields.push('start ' + p.preferred_hours_start); }
  if (p.preferred_hours_end) { partial.preferred_hours_end = String(p.preferred_hours_end); fields.push('finish ' + p.preferred_hours_end); }
  if (p.route_preferences) { partial.geographic_strategy = String(p.route_preferences); fields.push('route notes'); }
  if (p.brand_exclusions) { partial.brand_exclusions = String(p.brand_exclusions); fields.push('brand exclusions'); }
  if (p.max_stops_per_day != null && p.max_stops_per_day !== '') { partial.max_stops_per_day = parseInt(p.max_stops_per_day, 10) || 0; fields.push('max ' + partial.max_stops_per_day + ' stops'); }
  if (Array.isArray(p.days_off) && p.days_off.length) {
    const existing = parseContext(cur && cur.personal_context);
    const merged = Array.from(new Set(existing.days.concat(p.days_off)));
    partial.personal_context = buildContext(merged, existing.note);
    partial.works_saturdays = !merged.includes('Sat');
    fields.push('days off: ' + merged.join(', '));
  }
  if (!Object.keys(partial).length) return { ok: false, fields: [] };
  try { await fetch(`${META}/table/${TECH_TABLE}/content/${techId}`, { method: 'PUT', headers: h, body: JSON.stringify(partial) }); return { ok: true, fields }; }
  catch (_) { return { ok: false, fields: [] }; }
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

  const timeOff = Array.isArray(parsed.time_off) ? parsed.time_off.slice(0, 60) : [];
  let written = 0, failed = 0;
  for (const e of timeOff) { if (!e || !e.date) { failed++; continue; } const ok = await writeTimeOff(techId, e); if (ok) written++; else failed++; }

  let profileUpdated = { ok: false, fields: [] };
  if (parsed.profile && typeof parsed.profile === 'object') profileUpdated = await updateProfile(techId, parsed.profile);

  try {
    const tok = process.env.XANO_METADATA_TOKEN;
    if (tok) await fetch(`${META}/table/3/content`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'tech_scheduler_talk', metadata: { tech_id: techId, message, time_off_written: written, profile_fields: profileUpdated.fields, at_ms: Date.now() } }) });
  } catch (_) {}

  const reply = parsed.reply || (written || profileUpdated.ok ? 'Got it — saved.' : 'I didn\'t catch a date or preference there — try again?');
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, reply, time_off: written, profile_updated: profileUpdated.fields }) };
};
