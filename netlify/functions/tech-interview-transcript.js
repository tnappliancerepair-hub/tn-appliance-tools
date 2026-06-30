// tech-interview-transcript — build a tech's self-scheduling profile FROM the call
// transcript, instead of relying on the assistant to fire save_tech_profile mid-call
// (which wasn't sticking). The 10-min interview already captures everything; we just
// read the transcript afterward, extract the structured profile with Claude, and save
// it to event_log 'tech_profile_v1' (the same store get-tech-profile reads).
//
//   GET ?secret=&call_id=<vapiCallId>&tech_id=<n>   one call -> profile
//   GET ?secret=&backfill=1[&min=120][&force=1]     scan recent interview calls,
//        map by dialed tech number, extract+save each (skip already-done unless force)
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const VAPI = 'https://api.vapi.ai';
const INTERVIEW_ASSISTANT = 'ec2be4b8-c1c4-4c68-a7ea-d44f7d63a3e6';   // "Ant — Tech Setup"
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// dialed tech number (E.164, last 10) -> technician_id + name
const TECHS = { '6154855795': { id: 1, name: 'Teddy' }, '6159671304': { id: 2, name: 'Jimmy' }, '5049099413': { id: 3, name: 'Andre' }, '6158291654': { id: 4, name: 'Lee' }, '8133527686': { id: 6, name: 'John' } };
function techFromNumber(num) { const p10 = String(num || '').replace(/\D/g, '').slice(-10); return TECHS[p10] || null; }

async function vapiGet(path, key) {
  const r = await fetch(`${VAPI}${path}`, { headers: { Authorization: `Bearer ${key}` } });
  return r.ok ? r.json() : null;
}
function transcriptOf(call) {
  if (!call) return '';
  if (call.transcript) return String(call.transcript);
  if (call.artifact && call.artifact.transcript) return String(call.artifact.transcript);
  const msgs = (call.artifact && call.artifact.messages) || call.messages || [];
  return msgs.filter((m) => m.role !== 'system').map((m) => `${m.role === 'bot' || m.role === 'assistant' ? 'Ant' : 'Tech'}: ${m.message || m.content || ''}`).join('\n');
}

const EXTRACT_SYS = `You read a phone-interview transcript between "Ant" (an AI dispatcher) and an appliance-repair technician about how the tech wants his work day and route built. Extract a structured profile. Return ONLY valid JSON, no prose, no markdown fences. Use this exact shape (omit nothing; use null/empty when the tech didn't say):
{"start_earliest":"","start_ideal":"","end_latest":"","stops_good":null,"stops_max":null,"pace":"","days_off_hard":[],"days_off_reason":"","day_prefs_soft":"","weekends":"","life_windows":"","home_base":"","areas_pref":[],"drive_radius_mi":null,"areas_avoid":[],"last_stop_where":"","last_stop_why":"","appliance_strong":[],"appliance_avoid":[],"great_day":"","frustrating":"","notes":"","wants_more_work":false,"wants_area_pings":false}
Rules: hours as "8am"/"5pm" style text. stops_good/stops_max/drive_radius_mi = integers or null. days_off_hard = array of weekday names. areas_* = arrays of place/city names. wants_more_work/wants_area_pings = booleans. notes = anything important that doesn't fit a field (personal context, how Teddy can help). If the transcript is empty or has no real interview content, return the shape with all defaults.`;

async function extractProfile(transcript, key) {
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1200, system: EXTRACT_SYS, messages: [{ role: 'user', content: 'Transcript:\n\n' + transcript.slice(0, 24000) }] }),
  });
  if (!r.ok) throw new Error('anthropic ' + r.status);
  const d = await r.json();
  let txt = (d.content && d.content[0] && d.content[0].text) || '{}';
  txt = txt.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(txt);
}

// a profile "has content" if the tech actually told us something schedule-shaping
function profileHasContent(p) {
  if (!p) return false;
  return !!(p.start_ideal || p.start_earliest || p.end_latest || (p.days_off_hard && p.days_off_hard.length) || (p.areas_pref && p.areas_pref.length) || p.stops_max || p.stops_good || (p.appliance_strong && p.appliance_strong.length));
}
// done only if a NON-EMPTY transcript profile exists (so an empty save never blocks a real interview)
async function alreadyDone(techId) {
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'tech_profile_v1' }, { id: 'desc' }, 300);
    return rows.some((r) => { let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return Number(m.technician_id) === techId && m.source === 'transcript' && profileHasContent(m.profile); });
  } catch (_) { return false; }
}

async function saveProfile(tech, prof, callId) {
  await crud.logEvent('tech_profile_v1', {
    technician_id: tech.id, name: tech.name, profile: prof,
    wants_more_work: prof.wants_more_work === true, wants_area_pings: prof.wants_area_pings === true,
    source: 'transcript', call_id: callId || null, at_ms: Date.now(),
  });
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const vkey = await getSecret('VAPI_PRIVATE_KEY');
  const akey = await getSecret('ANTHROPIC_API_KEY') || process.env.ANTHROPIC_API_KEY;
  if (!vkey) return json(200, { ok: false, error: 'no VAPI_PRIVATE_KEY' });
  if (!akey) return json(200, { ok: false, error: 'no ANTHROPIC_API_KEY' });

  // single call
  if (q.call_id) {
    const call = await vapiGet(`/call/${q.call_id}`, vkey);
    if (!call) return json(200, { ok: false, error: 'call not found' });
    const tech = q.tech_id ? { id: Number(q.tech_id), name: TECHS[Object.keys(TECHS).find((k) => TECHS[k].id === Number(q.tech_id))]?.name || ('Tech ' + q.tech_id) } : techFromNumber(call.customer && call.customer.number);
    if (!tech) return json(200, { ok: false, error: 'could not map call to a tech — pass &tech_id=' });
    const tr = transcriptOf(call);
    if (tr.length < 80) return json(200, { ok: false, error: 'transcript too short / empty', length: tr.length });
    const prof = await extractProfile(tr, akey);
    await saveProfile(tech, prof, q.call_id);
    return json(200, { ok: true, tech, saved: true, profile: prof });
  }

  // pull a wide window of calls and keep only the ones on the INTERVIEW assistant,
  // mapped to a tech. (Filtering by assistant is what separates a real interview
  // from the tech calling in about a job.) Returns the LONGEST interview per tech.
  async function interviewCallsByTech(limit) {
    const list = await vapiGet(`/call?limit=${limit || 100}`, vkey);
    const calls = Array.isArray(list) ? list : (list && list.calls) || [];
    const best = {}; // techId -> {tech, call, dur}
    for (const c of calls) {
      if (c.assistantId !== INTERVIEW_ASSISTANT) continue;
      const tech = techFromNumber(c.customer && c.customer.number);
      if (!tech) continue;
      const dur = c.startedAt && c.endedAt ? (new Date(c.endedAt) - new Date(c.startedAt)) / 1000 : 0;
      if (!best[tech.id] || dur > best[tech.id].dur) best[tech.id] = { tech, call: c, dur };
    }
    return best;
  }

  // ?list=1 — diagnostic: which interview calls exist per tech (no save)
  if (q.list === '1') {
    const best = await interviewCallsByTech(parseInt(q.limit, 10) || 150);
    return json(200, { ok: true, interview_assistant: INTERVIEW_ASSISTANT, by_tech: Object.values(best).map((b) => ({ tech: b.tech.name, tech_id: b.tech.id, dur: Math.round(b.dur), call_id: b.call.id, transcript_len: transcriptOf(b.call).length })) });
  }

  // backfill: build each tech's profile from their longest interview-assistant call
  if (q.backfill === '1') {
    const min = parseInt(q.min, 10) || 120;
    const best = await interviewCallsByTech(parseInt(q.limit, 10) || 150);
    const out = [];
    for (const b of Object.values(best)) {
      const { tech, call, dur } = b;
      if (dur < min) { out.push({ tech: tech.name, skipped: 'longest interview only ' + Math.round(dur) + 's' }); continue; }
      const tr = transcriptOf(call);
      if (tr.length < 80) { out.push({ tech: tech.name, skipped: 'short transcript', dur: Math.round(dur) }); continue; }
      if (!q.force && await alreadyDone(tech.id)) { out.push({ tech: tech.name, skipped: 'already has profile' }); continue; }
      try { const prof = await extractProfile(tr, akey); await saveProfile(tech, prof, call.id); out.push({ tech: tech.name, tech_id: tech.id, dur: Math.round(dur), saved: true, days_off: prof.days_off_hard, areas: prof.areas_pref, start: prof.start_ideal }); }
      catch (e) { out.push({ tech: tech.name, error: String(e.message || e) }); }
    }
    return json(200, { ok: true, processed: out.length, results: out });
  }

  return json(200, { ok: false, error: 'pass &call_id=&tech_id=, &backfill=1, or &list=1' });
};
