// tech-missed-stop-check — late-day nudge to a tech about stops still OPEN on
// today's schedule, so a stop that got scrolled past / lost in the day gets
// caught while there's still time. (Teddy 2026-07-02: "Lee missed Mr. Bass —
// nudge the tech if something came off.")
//
// Runs a couple times in the afternoon (netlify.toml, ~4pm + 6pm CT) + a CT-hour
// guard. Per active tech: pull today's jobs; a stop counts as OPEN if it's not
// started/done/canceled/waiting-on-parts. If any, text the tech once per job per
// day (dedup marker) with the list + their day link.
//   GET ?dryrun=1   show who WOULD be nudged, send nothing
//   GET ?force=1    bypass the hour guard (for a test)
//   GET ?tech=4     only this tech (test)
'use strict';
const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const { sendSms } = require('./_lib/sms');

const ROSTER = [
  { id: 1, first: 'Teddy', phone: '+16154855795' },
  { id: 2, first: 'Jimmy', phone: '+16159671304' },
  { id: 3, first: 'Andre', phone: '+16159693115' },
  { id: 4, first: 'Lee',   phone: '+16158291654' },
  { id: 6, first: 'John',  phone: '+18133527686' },
];

// Statuses that mean "no nudge": already done, canceled, on it now, or legitimately
// waiting (parts/held). Anything else scheduled for today that isn't started = OPEN.
const NOT_OPEN = new Set([
  'completed', 'complete', 'canceled', 'cancelled', 'in_progress',
  'awaiting_parts', 'held', 'no_fix_possible', 'booked', 'paid',
]);

function ctParts() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const hour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }).format(now), 10);
  return { date, hour };
}
async function jget(url, ms = 9000) { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.json().catch(() => ({})); }
async function jpost(url, body, ms = 9000) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }); return r.json().catch(() => ({})); }
function resp(s, b) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// Is this job an OPEN (possibly-missed) stop for today?
function isOpenStop(entry) {
  const j = entry.job || entry;
  const c = entry.customer || {};
  const st = String(j.scheduling_status || j.current_status || '').toLowerCase();
  if (NOT_OPEN.has(st)) return null;
  if (j.job_started_at || j.job_completed_at) return null;  // already touched
  const who = (c.first_name || c.full_name || j.customer_name || 'a customer');
  const where = c.city || c.address_line1 || '';
  return { id: j.id || j.job_id, who, where, appliance: j.appliance_type || j.appliance || '' };
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const dryrun = q.dryrun === '1' || q.dryrun === 'true';
  const force = q.force === '1' || q.force === 'true';
  const onlyTech = q.tech ? Number(q.tech) : 0;
  const { date, hour } = ctParts();
  // Afternoon window only (never nudge before stops could reasonably be missed).
  if (!force && !dryrun && (hour < 15 || hour >= 20)) return resp(200, { ok: true, skipped: 'outside_window', hour });

  const out = { date_ct: date, hour, techs: [] };
  for (const t of ROSTER) {
    if (onlyTech && t.id !== onlyTech) continue;
    try {
      const d = await jget(`${XANO_BASE}/get_tech_daily_dashboard?tech_id=${t.id}&date=${date}`, 10000);
      const jobs = (d && d.jobs) || [];
      const open = jobs.map(isOpenStop).filter(Boolean);
      if (!open.length) { out.techs.push({ tech_id: t.id, name: t.first, open: 0 }); continue; }

      // Dedup: only nudge for jobs we haven't already nudged today.
      const fresh = [];
      for (const s of open) {
        try {
          const seen = await jget(`${XANO_BASE}/list_recent_event_log?action=missed_stop_nudge_${s.id}&days_back=1&limit=2`, 6000);
          const arr = (seen && seen.items) || [];
          if (!arr.length) fresh.push(s);
        } catch (_) { /* if we can't verify, skip to avoid double-nudge */ }
      }
      if (!fresh.length) { out.techs.push({ tech_id: t.id, name: t.first, open: open.length, fresh: 0 }); continue; }

      const list = fresh.slice(0, 4).map((s) => s.who + (s.where ? ' (' + s.where + ')' : '')).join(', ');
      const n = fresh.length;
      const body =
        'heads up ' + t.first + ' 🐜 — looks like ' + n + ' stop' + (n === 1 ? '' : 's') +
        ' may have slipped today: ' + list + '.' +
        ' Did you make it? If you can\'t get to one, open your day and tap it, or just reply and we\'ll help reschedule: ' +
        'tnapplianceexchange.net/tech-daily-dashboard.html?tech_id=' + t.id;

      if (dryrun) { out.techs.push({ tech_id: t.id, name: t.first, open: open.length, would_nudge: n, list }); continue; }

      const sent = await sendSms(t.phone, body, 'technician', 'tech_missed_stop_nudge');
      // Mark each job nudged so we don't repeat it today.
      for (const s of fresh) {
        try { await jpost(`${XANO_BASE}/record_event_log`, { action: `missed_stop_nudge_${s.id}`, metadata_json: JSON.stringify({ job_id: s.id, tech_id: t.id, who: s.who, at_ms: Date.now() }) }); } catch (_) {}
      }
      out.techs.push({ tech_id: t.id, name: t.first, open: open.length, nudged: n, sent });
    } catch (err) {
      out.techs.push({ tech_id: t.id, name: t.first, error: String(err.message || err) });
    }
  }
  return resp(200, { ok: true, ...out });
};
