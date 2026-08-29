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
const { commsFor, render } = require('./_lib/comms');
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
exports.config = { timeout: 26 };
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function dayLabel(d) { try { return new Date(String(d) + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); } catch (_) { return String(d); } }

async function ctx() {
  const base = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { base, H: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } };
}
async function sget(base, H, path) { try { const r = await fetch(base + '/rest/v1/' + path, { headers: H, signal: AbortSignal.timeout(9000) }); return r.ok ? (await r.json().catch(() => [])) : []; } catch (_) { return []; } }
async function sins(base, H, table, row) { try { await fetch(base + '/rest/v1/' + table, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(9000) }); } catch (_) {} }

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
  const out = { ok: true, date: tomorrow, dry, found: jobs.length, sent: 0, skipped_off: 0, skipped_dup: 0, skipped_nophone: 0, results: [] };

  for (const j of jobs) {
    if (out.sent >= 500) break;
    let co = coCache[j.company_id];
    if (!co) { co = (await sget(base, H, `company?id=eq.${j.company_id}&select=name,settings&limit=1`))[0] || {}; coCache[j.company_id] = co; }
    const rc = commsFor(co.settings || {}, 'reminder');
    if (!rc.on) { out.skipped_off++; continue; }

    // per-job dedupe — one reminder ever, even if the cron runs twice
    const dupe = await sget(base, H, `thread_message?job_id=eq.${j.id}&channel=eq.reminder&select=id&limit=1`);
    if (dupe && dupe.length) { out.skipped_dup++; continue; }

    const cus = (await sget(base, H, `customer?id=eq.${j.customer_id}&select=first_name,phone&limit=1`))[0] || {};
    const phone = String(cus.phone || '').trim();
    let techName = 'your technician';
    if (j.technician_id) { let tr = techCache[j.technician_id]; if (!tr) { tr = (await sget(base, H, `technician?id=eq.${j.technician_id}&select=name&limit=1`))[0] || {}; techCache[j.technician_id] = tr; } if (tr.name) techName = tr.name.split(' ')[0]; }
    let unit = 'appliance';
    if (j.unit_id) { let ur = unitCache[j.unit_id]; if (!ur) { ur = (await sget(base, H, `unit?id=eq.${j.unit_id}&select=label&limit=1`))[0] || {}; unitCache[j.unit_id] = ur; } if (ur.label) unit = ur.label; }

    const text = render(rc.text, { first: cus.first_name || 'there', shop: co.name || 'your appliance shop', tech: techName, day: dayLabel(j.scheduled_day || tomorrow), unit });
    out.results.push({ job: j.id, shop: co.name, to: phone ? '…' + phone.slice(-4) : '(no phone)', text });
    if (!phone) { out.skipped_nophone++; continue; }
    if (dry) { out.sent++; continue; }

    let ok = false; try { ok = await sendSms(phone, text, 'customer', 'platform_reminder'); } catch (_) {}
    await sins(base, H, 'thread_message', { company_id: j.company_id, customer_id: j.customer_id, job_id: j.id, direction: 'out', channel: 'reminder', sender: 'system', body: '🔔 Day-before reminder sent' });
    if (ok) out.sent++;
  }
  console.log('[appt-reminder]', JSON.stringify({ date: tomorrow, dry, found: out.found, sent: out.sent, off: out.skipped_off, dup: out.skipped_dup }));
  return json(200, out);
};
