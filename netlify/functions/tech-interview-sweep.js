// tech-interview-sweep — the hands-off half of the transcript->profile pipeline.
// Runs on a schedule, asks tech-interview-transcript to process any COMPLETED
// interview call that doesn't have a profile yet (it builds the profile from the
// transcript, not the flaky in-call tool), and texts Teddy when a new one lands.
// It only READS finished calls — it never dials a tech. Safe to leave on.
//   manual: GET ?secret=   (run a sweep now)
'use strict';
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const SITE = 'https://tnapplianceexchange.net';

async function runSweep() {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let d = {};
  try {
    const r = await fetch(`${SITE}/.netlify/functions/tech-interview-transcript?secret=${encodeURIComponent(admin)}&backfill=1`);
    d = await r.json();
  } catch (e) { return { ok: false, error: String(e.message || e) }; }

  const saved = (d.results || []).filter((x) => x.saved);
  for (const s of saved) {
    const off = (s.days_off && s.days_off.length) ? s.days_off.join('/') : 'none';
    const areas = (s.areas && s.areas.length) ? s.areas.join(', ') : '—';
    await sendSms('+16154855795', `🐜 ${s.tech}'s tech profile is built — start ${s.start || '?'}, off ${off}, areas: ${areas}. Self-scheduling can use it now.`, 'owner', 'tech_profile_built');
  }
  return { ok: true, new_profiles: saved.length, results: d.results || [] };
}

exports.handler = async function (event) {
  // manual run requires the admin secret; scheduled runs (no query) just go.
  const q = (event && event.queryStringParameters) || null;
  if (q && q.secret != null) {
    const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (q.secret !== admin) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };
  }
  const res = await runSweep();
  return { statusCode: 200, body: JSON.stringify(res, null, 2) };
};
