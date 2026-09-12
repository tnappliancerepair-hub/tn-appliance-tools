// platform-appt-reminder — the day-before "you're scheduled tomorrow with {tech}" text.
// Runs once each morning: finds every platform job scheduled for TOMORROW (CT), and texts the
// customer using THEIR shop's reminder template — but only if that shop left the reminder ON in
// its Communication Center (company.settings.comms.reminder). Per-job dedupe so it never double-texts.
//
//   GET/POST ?secret=<admin>     run now (sends, unless &dry=1)
//   &dry=1                       shadow — log who WOULD get texted, send nothing
//   &company=<id>                scope to one shop (testing)
//   scheduled (Netlify cron)     self-authorizes via {next_run}
'use strict';
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const { claimSend, onceKey } = require('./_lib/send-once');
const { commsFor, render } = require('./_lib/comms');
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
exports.config = { timeout: 26 };
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function dayLabel(d) { try { return new Date(String(d) + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); } catch (_) { return String(d); } }
// "washer" / "washer and dryer" / "washer, dryer and cooktop" — one visit reads as one visit.
function joinUnits(a) {
  const u = (a || []).filter(Boolean);
  if (!u.length) return 'appliance';
  if (u.length === 1) return u[0];
  if (u.length === 2) return u[0] + ' and ' + u[1];
  return u.slice(0, -1).join(', ') + ' and ' + u[u.length - 1];
}

async function ctx() {
  const base = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { base, H: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } };
}
async function sget(base, H, path) { try { const r = await fetch(base + '/rest/v1/' + path, { headers: H, signal: AbortSignal.timeout(9000) }); return r.ok ? (await r.json().catch(() => [])) : []; } catch (_) { return []; } }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const guard = (await getSecret('ADMIN_SECRET')) || GUARD_FALLBACK;
  if (!scheduled && q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });
  const dry = !!q.dry;

  const { base, H } = await ctx();
  if (!base || !H.apikey) return json(200, { ok: false, error: 'platform_not_configured' });

  // Tomorrow's date in America/Chicago (YYYY-MM-DD).
  const todayCT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  const t = new Date(todayCT + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1);
  const tomorrow = t.toISOString().slice(0, 10);

  let jf = `job?scheduled_day=eq.${tomorrow}&status=in.(new,scheduled)&select=id,company_id,customer_id,technician_id,unit_id,problem&limit=1000`;
  if (q.company) jf += `&company_id=eq.${encodeURIComponent(q.company)}`;
  const jobs = await sget(base, H, jf);

  const coCache = {}, techCache = {}, unitCache = {};
  const out = { ok: true, date: tomorrow, dry, found: jobs.length, stops: 0, sent: 0, skipped_off: 0, skipped_dup: 0, skipped_nophone: 0, send_failed: 0, results: [] };

  // A stop can carry more than one machine — an AHS dispatch often covers a washer AND a dryer,
  // and each machine is its OWN job row. Keyed per job, that customer got one text per machine.
  // Measured 2026-09-10 on TN's own board: 32 multi-machine stops in 60 days, 71 jobs across
  // them, biggest a three-machine stop. So group by CUSTOMER first — one visit, one reminder,
  // naming every appliance we're coming for.
  const groups = new Map();
  for (const j of jobs) {
    const gk = String(j.company_id) + '|' + String(j.customer_id);
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(j);
  }
  out.stops = groups.size;

  for (const grp of groups.values()) {
    if (out.sent >= 500) break;
    const j = grp[0];
    let co = coCache[j.company_id];
    if (!co) { co = (await sget(base, H, `company?id=eq.${j.company_id}&select=name,settings&limit=1`))[0] || {}; coCache[j.company_id] = co; }
    const rc = commsFor(co.settings || {}, 'reminder');
    if (!rc.on) { out.skipped_off += grp.length; continue; }

    // Cheap pre-filter across EVERY job on the stop. It also catches markers written before
    // 2026-09-10, which were keyed per job. The claim below is what actually decides.
    const ids = grp.map((g) => g.id).join(',');
    const dupe = await sget(base, H, `thread_message?job_id=in.(${ids})&channel=eq.reminder&select=id&limit=1`);
    if (dupe && dupe.length) { out.skipped_dup++; continue; }

    const cus = (await sget(base, H, `customer?id=eq.${j.customer_id}&select=first_name,phone&limit=1`))[0] || {};
    const phone = String(cus.phone || '').trim();

    const techId = (grp.find((g) => g.technician_id) || {}).technician_id;
    let techName = 'your technician';
    if (techId) { let tr = techCache[techId]; if (!tr) { tr = (await sget(base, H, `technician?id=eq.${techId}&select=name&limit=1`))[0] || {}; techCache[techId] = tr; } if (tr.name) techName = tr.name.split(' ')[0]; }

    const labels = [];
    for (const g of grp) {
      if (!g.unit_id) continue;
      let ur = unitCache[g.unit_id];
      if (!ur) { ur = (await sget(base, H, `unit?id=eq.${g.unit_id}&select=label&limit=1`))[0] || {}; unitCache[g.unit_id] = ur; }
      const lbl = String((ur && ur.label) || '').trim();
      if (lbl && lbl.toLowerCase() !== 'appliance' && labels.indexOf(lbl) === -1) labels.push(lbl);
    }

    const text = render(rc.text, { first: cus.first_name || 'there', shop: co.name || 'your appliance shop', tech: techName, day: dayLabel(tomorrow), unit: joinUnits(labels) });
    out.results.push({ jobs: grp.map((g) => g.id), shop: co.name, to: phone ? '…' + phone.slice(-4) : '(no phone)', text });
    if (!phone) { out.skipped_nophone++; continue; }
    if (dry) { out.sent++; continue; }

    // CLAIM BEFORE SEND. The old order was read-marker -> send -> write-marker, so two
    // concurrent runs both passed the check and both texted. Measured 2026-09-07: 42 markers
    // across 25 jobs -- 17 customers got the reminder TWICE. Writing the marker FIRST collapses
    // the race to a single insert, and thread_send_once_uidx refuses the loser outright, so it
    // never sends. Failure direction is now a MISSED reminder (silent, recoverable) instead of
    // a double text -- the right trade on any customer-facing send.
    // The key is CUSTOMER + DAY, not the job, so a multi-machine stop can only claim once.
    const claimed = await claimSend(base, H, { company_id: j.company_id, customer_id: j.customer_id, job_id: j.id, direction: 'out', channel: 'reminder', sender: 'system', body: '🔔 Day-before reminder sent' + (grp.length > 1 ? ' (' + grp.length + ' machines on this stop)' : '') }, onceKey('reminder', j.customer_id + ':' + tomorrow));
    if (!claimed) { out.skipped_dup++; continue; }
    let ok = false; try { ok = await sendSms(phone, text, 'customer', 'platform_reminder'); } catch (_) {}
    if (ok) out.sent++; else out.send_failed = (out.send_failed || 0) + 1;
  }

  console.log('[appt-reminder]', JSON.stringify({ date: tomorrow, dry, found: out.found, stops: out.stops, sent: out.sent, off: out.skipped_off, dup: out.skipped_dup, send_failed: out.send_failed }));
  return json(200, out);
};
