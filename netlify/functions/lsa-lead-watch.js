// lsa-lead-watch — tell Teddy the moment Google charges us for a Local Services lead.
//
// WHY THIS EXISTS (measured live 2026-09-15, the day Teddy said "we missed five or six
// strong leads today and I'm not sure where those calls are going"):
//
//   • LSA delivered 6 leads that day (5 phone + 1 message), 5 of them CHARGED at
//     ~$18.05 each. He was exactly right about the count.
//   • Those calls land on 615-280-2949 -- the SAME number as the Google Business
//     Profile, the website, and every business card. There is no dedicated LSA line,
//     so a $18 paid lead is indistinguishable from any other call the instant it
//     arrives. Ann answers it like the other 55 calls that day.
//   • Four of them came in between 2:49 and 3:14 PM CT. In that entire window there
//     were ZERO transfer attempts to a human -- the last one of the day fired at 1:46.
//   • 61 inbound calls that day produced 0 `callback_request`, 0 `call_outcome`, and
//     0 jobs. Every one of the 29 jobs created that day came from warranty EMAIL.
//
// So the leads were not "going" anywhere in particular. They were being answered by
// Ann and never written down, and nothing anywhere told a human that money had just
// been spent. This closes that specific hole: within ~10 minutes of Google booking a
// lead, the owner's phone knows about it, what appliance it was, and that it cost us.
//
// ⚠️ THIS IS NOT THE ROUTING FIX. It cannot be -- the API does not expose the caller's
// number (contact_details is rejected outright; probed all three subfields live), so
// nothing here can dial anybody or match a lead to a job. Sending the CALL to Teddy
// first requires a dedicated LSA number pointed at google-line-texml, which changes
// live call routing and is Teddy's call to make. This is the interim that stops a paid
// lead from going unnoticed in the meantime.
//
// ⚠️ TEXTS TEDDY ONLY. _lib/office-gate is a hard rule (Teddy 2026-08-28: "No more
// texting Danielle, Sofia or Carrie"). The tag 'lsa_lead' is allowlisted in
// CASH_INTAKE_TAGS for exactly this -- an un-allowlisted tag is written and delivered
// NOWHERE, which is the trap cash-ready-notify sat in for three weeks.
//
// ⚠️ FORWARD-ONLY BY CONSTRUCTION. It only ever considers leads younger than
// FIRST_TOUCH_MAX_H, so the first run can never fire at the back catalogue (38 leads
// exist all-time). The age floor is the guard and it needs no bookkeeping.
//
// It NEVER texts the customer. Standing rule: no proactive customer texts.
//
//   GET ?secret=<admin>[&dry=1]   dry=1 lists what WOULD send and texts nobody
//
// Kill: vault LSA_LEAD_WATCH=false. Quiet the 3h nag only: LSA_LEAD_RENAG=false.
'use strict';

const { recentLeads } = require('./_lib/lsa');
const { sendSmsDetailed } = require('./_lib/sms');
const { getSecretPreferVault } = require('./_lib/secrets');
let crud = null; try { crud = require('./_lib/xano/metadata-crud'); } catch (_) {}

const OWNER = '+16154855795';
const TAG   = 'lsa_lead';
const XANO  = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const ADMIN_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';   // same constant sb-admin-sql carries

const FIRST_TOUCH_MAX_H = 3;    // older than this is history, never a first touch
const RENAG_H           = 3;    // still unanswered in the LSA app this long -> one nag, ever
const MAX_PER_RUN       = 5;    // a burst can never flood; the rest rolls to the next tick
const OPEN_H            = 7;    // paid leads are worth an early/late text, but not overnight
const CLOSE_H           = 21;

// Statuses that mean a human has NOT closed the loop in the Local Services app.
// Anything else (BOOKED, DECLINED, EXPIRED, WIPED_OUT...) is settled -- never nag it.
const OPEN_STATUSES = new Set(['NEW', 'ACTIVE']);

const json = (s, b) => ({ statusCode: s, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) });
const ctHour = () => { try { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date())); } catch (_) { return 12; } };
const ctDate = () => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()); } catch (_) { return new Date().toISOString().slice(0, 10); } };

// creation_date_time is already Central (account timezone verified America/Chicago),
// so parse it as a wall clock and do NOT shift it.
function ctParts(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, h: Number(m[4]), min: m[5] };
}
function clockCT(s) {
  const p = ctParts(s);
  if (!p) return '';
  const ampm = p.h >= 12 ? 'PM' : 'AM';
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${h12}:${p.min} ${ampm}`;
}
// Minutes elapsed since a Central wall-clock stamp, using the same zone for "now" so
// the two are comparable without a UTC conversion either side.
function minsSinceCT(s) {
  const p = ctParts(s);
  if (!p) return 0;
  let nowDate, nowH, nowM;
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
    nowDate = `${f.year}-${f.month}-${f.day}`; nowH = Number(f.hour === '24' ? 0 : f.hour); nowM = Number(f.minute);
  } catch (_) { return 0; }
  const days = Math.round((Date.parse(nowDate + 'T00:00:00Z') - Date.parse(p.date + 'T00:00:00Z')) / 86400000);
  return (days * 1440) + ((nowH * 60 + nowM) - (p.h * 60 + Number(p.min)));
}

// repair_refrigerator -> "refrigerator repair". An unmapped/absent service id must never
// read as a bare blank on his phone, so it falls back to the honest generic.
function serviceLabel(sid) {
  const s = String(sid || '').trim();
  if (!s) return 'appliance repair';
  const m = /^repair_(.+)$/.exec(s);
  if (m) return `${m[1].replace(/_/g, ' ')} repair`;
  return s.replace(/_/g, ' ');
}
const ord = (n) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

// Read the alert ledger. One read, not one per lead. A failed read must FAIL CLOSED --
// an empty set would re-text every lead in the window, so on error we send nothing.
async function alertedSets() {
  const r = await fetch(`${XANO}/list_recent_event_log?action=lsa_lead_alerted&days_back=2&limit=300`, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`event_log read ${r.status}`);
  const d = await r.json().catch(() => ({}));
  const first = new Set(), nagged = new Set();
  for (const it of (d.items || [])) {
    let m = it.metadata || {};
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    const id = String(m.lead_id || '');
    if (!id) continue;
    if (m.kind === 'renag') nagged.add(id); else first.add(id);
  }
  return { first, nagged };
}

async function run(opts) {
  const dry = !!(opts && opts.dry);
  if (String(await getSecretPreferVault('LSA_LEAD_WATCH') || '').toLowerCase() === 'false') {
    return { ok: true, disabled: true };
  }
  const hour = ctHour();
  if (!dry && (hour < OPEN_H || hour >= CLOSE_H)) {
    return { ok: true, skipped: `outside ${OPEN_H}a-${CLOSE_H - 12}p CT`, ct_hour: hour };
  }

  // Pull a wider window than the first-touch floor so the nag pass has something to see.
  const pulled = await recentLeads(Date.now() - (FIRST_TOUCH_MAX_H + RENAG_H + 6) * 3600000);
  if (!pulled.ok) return { ok: false, step: 'lsa_read', error: pulled.error || pulled, configured: pulled.configured };
  if (!pulled.found) return { ok: true, found: false, note: 'no LOCAL_SERVICES campaign reachable' };
  const leads = pulled.leads || [];
  if (!leads.length) return { ok: true, mode: dry ? 'dry' : 'live', candidates: 0, alerted: 0 };

  const seen = await alertedSets();          // throws -> handler reports it, nothing sends
  const today = ctDate();
  const todayLeads = leads.filter((l) => String(l.created_ct).slice(0, 10) === today);
  const nagOn = String(await getSecretPreferVault('LSA_LEAD_RENAG') || '').toLowerCase() !== 'false';

  const queue = [];
  for (const l of leads) {
    const age = minsSinceCT(l.created_ct);
    const isNew = !seen.first.has(l.id);
    if (isNew) {
      if (age > FIRST_TOUCH_MAX_H * 60) continue;            // forward-only floor
      queue.push({ lead: l, kind: 'first', age });
      continue;
    }
    if (!nagOn || seen.nagged.has(l.id)) continue;
    if (!OPEN_STATUSES.has(String(l.status).toUpperCase())) continue;   // settled in the app
    if (age < RENAG_H * 60) continue;
    queue.push({ lead: l, kind: 'renag', age });
  }
  // Newest first, first-touch ahead of nags -- a brand-new paid lead outranks a reminder.
  queue.sort((a, b) => (a.kind === b.kind ? (a.lead.created_ct < b.lead.created_ct ? 1 : -1) : (a.kind === 'first' ? -1 : 1)));

  const out = [];
  for (const item of queue.slice(0, MAX_PER_RUN)) {
    const l = item.lead;
    const what = serviceLabel(l.service_id);
    const when = clockCT(l.created_ct);
    const how  = String(l.type) === 'MESSAGE' ? 'message' : 'call';
    const nth  = todayLeads.findIndex((x) => x.id === l.id);
    const rank = nth >= 0 ? ord(todayLeads.length - nth) : null;

    const body = item.kind === 'first'
      ? `LSA LEAD${l.charged ? ' (we paid ~$18)' : ''} - ${what}, ${how} at ${when} CT.`
        + ` Call them back in the Local Services app.`
        + (rank ? ` ${rank} LSA lead today.` : '')
      : `LSA lead from ${when} CT (${what}) is STILL open in the Local Services app`
        + ` - ${Math.floor(item.age / 60)}h and nobody has answered it.`
        + ` Reach them, then mark it booked there.`;

    if (dry) { out.push({ lead_id: l.id, kind: item.kind, age_min: item.age, would_send: body }); continue; }

    let res = { sent: false, reason: 'unknown' };
    try { res = await sendSmsDetailed(OWNER, body, 'owner', TAG); } catch (e) { res = { sent: false, reason: String(e.message || e).slice(0, 80) }; }
    // Ledger the attempt either way. A send that was refused (dup-suppressed, quiet
    // hours) must not come back on the next tick and try again forever.
    if (crud) {
      try {
        await crud.logEvent('lsa_lead_alerted', {
          lead_id: l.id, kind: item.kind, service: what, lead_type: l.type,
          charged: l.charged, status: l.status, created_ct: l.created_ct,
          age_min: item.age, sent: !!res.sent, reason: res.reason || null, at_ms: Date.now(),
        });
      } catch (_) {}
    }
    out.push({ lead_id: l.id, kind: item.kind, sent: !!res.sent, reason: res.reason || null });
  }

  return {
    ok: true, mode: dry ? 'dry' : 'live', ct_hour: hour, cid: pulled.cid,
    pulled: leads.length, leads_today: todayLeads.length,
    queued: queue.length, acted: out.length, deferred: Math.max(0, queue.length - out.length),
    renag_enabled: nagOn, results: out,
  };
}

exports.run = run;

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  // Scheduled invocations carry no query string, so let the cron wrapper through on the
  // {next_run} body the platform sends. Manual calls must present the secret. Deliberately
  // NOT `if (!scheduled && admin && ...)` -- that `admin &&` opens the door on an empty
  // read, which is how platform-migration-watch ended up ungated.
  let scheduled = false;
  try { scheduled = !!JSON.parse((event && event.body) || '{}').next_run; } catch (_) {}
  const admin = (await getSecretPreferVault('VAPI_ADMIN_SECRET')) || process.env.VAPI_ADMIN_SECRET || ADMIN_FALLBACK;
  if (!scheduled && q.secret !== admin) return json(403, { ok: false, error: 'forbidden' });
  try { return json(200, await run({ dry: q.dry === '1' })); }
  catch (e) { return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) }); }
};
