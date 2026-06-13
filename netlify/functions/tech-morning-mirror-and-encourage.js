// Daily tech morning briefing — each active tech gets a text with today's
// schedule (how many stops, first one) + a link to their day + a light nudge.
// Standing daily; runs ~7am CT (netlify.toml "0 12 * * *"). Only texts techs
// who actually have jobs today (no empty-day spam). Reads each tech's day from
// Ant (get_tech_daily_dashboard) — schedule now lives in Ant, not HCP.

'use strict';

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const { sendSms } = require('./_lib/sms');

// Active techs (CLAUDE.md roster). Teddy (1) included — he runs jobs too.
const ROSTER = [
  { id: 1, first: 'Teddy', phone: '+16154855795' },
  { id: 2, first: 'Jimmy', phone: '+16159671304' },
  { id: 3, first: 'Andre', phone: '+16159693115' },
  { id: 4, first: 'Lee',   phone: '+16158291654' },
  { id: 5, first: 'Billy', phone: '+17315049617' },
  { id: 6, first: 'John',  phone: '+18133527686' },
];

function ctParts() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const hour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }).format(now), 10);
  return { date, hour };
}
function fmtTime(ms) {
  if (!ms) return '';
  try { return new Date(Number(ms)).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; }
}

exports.handler = async () => {
  const { date, hour } = ctParts();
  // Morning window guard (defense if the cron ever misfires off-hour).
  if (hour < 5 || hour > 10) return jsonResp(200, { ok: true, skipped: 'outside_morning', hour });

  const out = { date_ct: date, techs: [] };
  for (const t of ROSTER) {
    try {
      const r = await fetch(`${XANO_BASE}/get_tech_daily_dashboard?tech_id=${t.id}&date=${date}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      const jobs = (d && d.jobs) || [];
      const n = (d && d.job_count != null) ? d.job_count : jobs.length;
      if (!n) { out.techs.push({ tech_id: t.id, name: t.first, jobs: 0, skipped: true }); continue; }

      // First stop details (jobs nested as {job, customer}).
      const first = jobs[0] || {};
      const fj = first.job || first;
      const fc = first.customer || {};
      const firstTime = fmtTime(fj.scheduled_start);
      const where = [fc.first_name, fc.city].filter(Boolean).join(' · ');
      const firstBit = firstTime ? (' First: ' + firstTime + (where ? ' (' + where + ')' : '') + '.') : '';

      const body =
        'morning ' + t.first + ' 🐜 — you\'ve got ' + n + ' stop' + (n === 1 ? '' : 's') + ' today.' + firstBit +
        ' Open your day: tnapplianceexchange.net/tech-daily-dashboard.html?tech_id=' + t.id +
        ' — tap a stop to start, and just text or talk to Ant if you need anything.';

      const sent = await sendSms(t.phone, body, 'technician', 'tech_morning_briefing');
      out.techs.push({ tech_id: t.id, name: t.first, jobs: n, sent });
    } catch (err) {
      out.techs.push({ tech_id: t.id, name: t.first, error: String(err.message || err) });
    }
  }
  return jsonResp(200, { ok: true, ...out });
};

function jsonResp(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, null, 2) };
}
