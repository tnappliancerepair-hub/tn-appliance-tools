// new-lead-alert — the moment a number we do not know calls the shop, TEDDY AND
// DANIELLE get a text with that number. Any hour, any day.
//
// TEDDY, 2026-09-15 (right after six paid LSA leads went unanswered):
//   "All new jobs coming in tomorrow as they come in. I need to be text messaged about
//    it. Danielle needs to be text messaged about it. New cash lead. We need their
//    phone number and their information. As soon as they call us, even after hours,
//    I need the information sent to me."
//
// WHAT TODAY PROVED (all measured, not assumed):
//   • 61 inbound calls produced 0 callback_request, 0 call_outcome and 0 jobs. Every
//     one of the 29 jobs created that day came from warranty EMAIL. Ann answered the
//     phone all day and wrote nothing down.
//   • The LSA API CANNOT give us the caller's number -- contact_details is rejected
//     outright (probed phone_number / consumer_name / email live, all 400). So the
//     lead feed can tell us money was spent and never who to call.
//   • But the PRE-CALL webhook already has it. `telnyx_precall_hit` carries the real
//     caller ID on every inbound call (72 rows today, 35 distinct callers), and four
//     of today's LSA leads are sitting in it by the minute: 14:49, 14:51, 14:55, 15:14
//     against LSA's 2:49 / 2:51 / 2:55 / 3:14 PM. The numbers were here the whole time;
//     nothing read them.
//
// WHY A CRON AND NOT AN INLINE SEND FROM PRECALL. Precall is the dynamic-variables
// webhook. Telnyx drops it after ~2s and then speaks the literal "{{greeting}}" at a
// live customer -- that exact failure is in the changelog. Its whole lookup already
// races a 2000ms deadline. Hanging a carrier round-trip off that path trades a paid
// lead's greeting for a text, which is the wrong trade. So this reads the row precall
// ALREADY writes, on a 2-minute tick. Worst-case latency is ~2 minutes and the live
// call cannot be harmed by anything in this file.
//
// ⚠️ NO HOURS GATE, DELIBERATELY. "even after hours" was explicit. Every other watcher
// here is gated (lsa-lead-watch 7a-9p, platform-lead-watch 8a-8p). This one is not.
// Role 'owner'/'office' are INTERNAL_ROLES in _lib/sms, so the quiet-hours block does
// not apply either -- a 2am lead reaches both phones at 2am, on purpose.
//
// ⚠️ THIS IS THE FIRST THING TO REACH DANIELLE'S PHONE SINCE 2026-08-28, when Teddy
// said "No more texting Danielle, Sofia or Carrie." He asked for her by name here, so
// office-gate opens for EXACTLY this one tag, to HER only. Sofia and Carrie stay shut.
// Kill her copy alone with vault NEW_LEAD_ALERT_DANIELLE=false.
//
// ⚠️ WE DO NOT FILTER BY AREA CODE. It is tempting -- 11 of today's 24 unknown callers
// were out-of-region and most of those are junk. But Nashville is a transplant city and
// people keep their old cell number forever, so a 312 or 407 caller is a real homeowner
// often enough. A wasted glance costs nothing; a dropped lead costs a job. Toll-free is
// the one safe cut: a homeowner does not call you from an 800 number.
//
// It NEVER texts the customer. Standing rule: no proactive customer texts.
//
//   GET ?secret=<admin>[&dry=1][&mins=N]   dry=1 lists what WOULD send and texts nobody
//
// Kill everything: vault NEW_LEAD_ALERT=false.
// Just Danielle's copy: NEW_LEAD_ALERT_DANIELLE=false.
// Too noisy? NEW_LEAD_ALERT_LOCAL_ONLY=true cuts out-of-region numbers (today that is 9
// of 21 -- mostly robocalls, but it WILL also drop a transplant homeowner now and then).
'use strict';

const { sendSmsDetailed } = require('./_lib/sms');
const { getSecretPreferVault } = require('./_lib/secrets');
let crud = null; try { crud = require('./_lib/xano/metadata-crud'); } catch (_) {}

const OWNER    = '+16154855795';   // Teddy
const DANIELLE = '+16154850713';
const TAG      = 'new_cash_lead';
const XANO     = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const ADMIN_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

const LOOKBACK_MIN = 30;   // wider than the 2-min tick so a missed tick still catches up
const DEDUP_H      = 24;   // one text per caller per day, however many times they ring
const MAX_PER_RUN  = 6;    // a burst can never flood; the rest rolls to the next tick

// Our own people and our own lines. A call FROM one of these is a test or a routing
// artifact, never a lead. Crew + office from vapi-webhook's INTERNAL_NUMBERS and
// office-gate's OFFICE set; the DIDs are the lines that reach Ann.
const INTERNAL = new Set([
  '6154855795', // Teddy
  '6154850713', // Danielle
  '6292594602', // Sofia
  '2258035669', // Carrie
  '6159671304', // Jimmy
  '5049099413', // Andre (504, system-of-record)
  '6159693115', // Andre (old 615)
  '6158291654', // Lee
  '8133527686', // John
  '7315049617', // Billy (left July)
  // shop lines
  '6152802949', // main / GBP / website / LSA
  '6155889500', // customer SMS + inbound
  '6158578800', // human line
  '6157575500', // tech line
  '6158458500', // Google Ads line
  '6158211400', // warranty desk
  '6155889591', // office ring group
  '8662680111', '8882688998',
  '6292607111', '6292477111', '5043701234', '5043800975', '7315031142',
  '2256051234', // Baton Rouge DID (stray verify line)
  '6155551212', // warm-phone keep-alive ping
]);
const TOLLFREE = /^1?(800|888|877|866|855|844|833)/;

// The area codes we actually drive to. NOT used by default -- see the header: a 407 or a
// 214 caller is a real homeowner often enough that filtering on this loses jobs. It exists
// only because today's replay showed 21 alerts/day of which 9 were out-of-region numbers
// that look like robocalls, and a feed that floods gets muted, which is how the signal
// dies. Flip vault NEW_LEAD_ALERT_LOCAL_ONLY=true to trade those 9 away. Off by default.
const SERVICE_AREA = /^(615|629|931|423|865|901|504|985|225|337|318)/;

// The lines we can name, so the text says where the lead came from. Anything else just
// reads as "our line" rather than guessing.
const LINES = {
  '6152802949': 'the main line',
  '6158458500': 'the Google Ads line',
  '6155889500': 'the 588 line',
  '6158578800': 'the office line',
  '6158211400': 'the warranty desk line',
};

function last10(p) { return String(p || '').replace(/\D/g, '').slice(-10); }
function pretty(d) { const s = last10(d); return s.length === 10 ? `(${s.slice(0, 3)}) ${s.slice(3, 6)}-${s.slice(6)}` : String(d || ''); }

// Central wall clock for a unix ms. The office reads times in CT and nothing else.
function clockCT(ms) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(ms));
  } catch (_) { return ''; }
}

// The dialed line. Prefer the explicit field; fall back to digging it out of the raw
// payload so rows logged before that field existed still name their line.
function dialedDigits(m) {
  const explicit = last10(m && m.to_resolved);
  if (explicit.length === 10) return explicit;
  const raw = String((m && m.raw) || '');
  const hit = /"to"\s*:\s*"(\+?\d[\d\-() ]{7,})"/.exec(raw);
  return hit ? last10(hit[1]) : '';
}

// Who has already been alerted. ONE read, and it must FAIL CLOSED -- an empty set on a
// failed read would re-text every caller in the window, so on error we send nothing.
async function alreadyAlerted() {
  const r = await fetch(`${XANO}/list_recent_event_log?action=new_cash_lead_alerted&days_back=2&limit=400`, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`event_log read ${r.status}`);
  const d = await r.json().catch(() => ({}));
  const floor = Date.now() - DEDUP_H * 3600000;
  const seen = new Set();
  for (const it of (d.items || [])) {
    let m = it.metadata || {};
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    const at = Number(m.at_ms || it.created_at || 0);
    if (at && at < floor) continue;
    const dg = last10(m.caller);
    if (dg) seen.add(dg);
  }
  return seen;
}

// Every inbound call in the window, newest first, one entry per caller.
async function recentCallers(mins) {
  const r = await fetch(`${XANO}/list_recent_event_log?action=telnyx_precall_hit&days_back=1&limit=400`, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`precall read ${r.status}`);
  const d = await r.json().catch(() => ({}));
  const floor = Date.now() - mins * 60000;
  const byCaller = new Map();
  for (const it of (d.items || [])) {
    let m = it.metadata || {};
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    const at = Number(m.at_ms || it.created_at || 0);
    if (!at || at < floor) continue;
    const dg = last10(m.from_resolved);
    if (dg.length !== 10) continue;                       // no caller ID -> nothing to call back
    const prev = byCaller.get(dg);
    // Keep the EARLIEST ring in the window: that is when they actually reached out.
    if (!prev || at < prev.at) byCaller.set(dg, { caller: dg, at, line: dialedDigits(m) });
    else if (!prev.line && dialedDigits(m)) prev.line = dialedDigits(m);
  }
  return [...byCaller.values()].sort((a, b) => b.at - a.at);
}

// Is this number already a customer of ours? Known caller = not a new lead.
// A failed/slow lookup returns null, and null is treated as UNKNOWN on purpose: the
// asymmetry runs one way here. An extra text about an existing customer costs a glance;
// swallowing a real lead costs the job that this whole file exists to stop losing.
async function knownCustomer(digits) {
  try {
    const r = await fetch(`${XANO}/lookup_customer_by_phone?phone=${digits}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json().catch(() => ({}));
    if (!d || !d.found) return null;
    const c = d.customer || {};
    const name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
    return { name };
  } catch (_) { return null; }
}

function skipReason(c, localOnly) {
  if (INTERNAL.has(c.caller)) return 'internal';
  if (TOLLFREE.test(c.caller) || TOLLFREE.test('1' + c.caller)) return 'toll_free';
  if (localOnly && !SERVICE_AREA.test(c.caller)) return 'out_of_area';
  return '';
}

async function run(opts) {
  const dry  = !!(opts && opts.dry);
  const mins = Math.max(1, Math.min(720, Number((opts && opts.mins) || LOOKBACK_MIN)));
  if (String(await getSecretPreferVault('NEW_LEAD_ALERT') || '').toLowerCase() === 'false') {
    return { ok: true, disabled: true };
  }
  // NOTE: there is intentionally no business-hours check here. See the header.

  const callers = await recentCallers(mins);
  if (!callers.length) return { ok: true, mode: dry ? 'dry' : 'live', window_min: mins, callers: 0, alerted: 0 };

  const seen = await alreadyAlerted();          // throws -> handler reports, nothing sends
  const toDanielle = String(await getSecretPreferVault('NEW_LEAD_ALERT_DANIELLE') || '').toLowerCase() !== 'false';
  const localOnly  = String(await getSecretPreferVault('NEW_LEAD_ALERT_LOCAL_ONLY') || '').toLowerCase() === 'true';

  const queue = [], skipped = [];
  for (const c of callers) {
    const why = skipReason(c, localOnly);
    if (why) { skipped.push({ caller: c.caller, why }); continue; }
    if (seen.has(c.caller)) { skipped.push({ caller: c.caller, why: 'already_alerted' }); continue; }
    const known = await knownCustomer(c.caller);
    if (known) { skipped.push({ caller: c.caller, why: 'known_customer', name: known.name }); continue; }
    queue.push(c);
  }

  const out = [];
  for (const c of queue.slice(0, MAX_PER_RUN)) {
    const where = LINES[c.line] || 'our line';
    const body = `NEW CASH LEAD - ${pretty(c.caller)} called ${where} at ${clockCT(c.at)} CT.`
      + ` They are not in our system, so nobody has their job yet.`
      + ` Call them back: ${c.caller}`;

    if (dry) { out.push({ caller: c.caller, line: c.line || null, would_send: body }); continue; }

    const res = { teddy: null, danielle: null };
    try { res.teddy = await sendSmsDetailed(OWNER, body, 'owner', TAG); }
    catch (e) { res.teddy = { sent: false, reason: String(e.message || e).slice(0, 80) }; }
    if (toDanielle) {
      try { res.danielle = await sendSmsDetailed(DANIELLE, body, 'office', TAG); }
      catch (e) { res.danielle = { sent: false, reason: String(e.message || e).slice(0, 80) }; }
    }

    // Ledger the attempt either way. A send that was refused (suppressed, carrier
    // failure) must not come back on the next tick and try forever.
    if (crud) {
      try {
        await crud.logEvent('new_cash_lead_alerted', {
          caller: c.caller, line: c.line || '', called_at_ms: c.at, called_ct: clockCT(c.at),
          teddy_sent: !!(res.teddy && res.teddy.sent), teddy_reason: (res.teddy && res.teddy.reason) || null,
          danielle_sent: !!(res.danielle && res.danielle.sent), danielle_reason: (res.danielle && res.danielle.reason) || null,
          at_ms: Date.now(),
        });
      } catch (_) {}
    }
    out.push({
      caller: c.caller, line: c.line || null,
      teddy: !!(res.teddy && res.teddy.sent),
      danielle: toDanielle ? !!(res.danielle && res.danielle.sent) : 'off',
      reason: (res.teddy && res.teddy.reason) || null,
    });
  }

  return {
    ok: true, mode: dry ? 'dry' : 'live', window_min: mins,
    callers: callers.length, queued: queue.length, acted: out.length,
    deferred: Math.max(0, queue.length - out.length),
    danielle_enabled: toDanielle, local_only: localOnly, results: out, skipped,
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
  if (!scheduled) {
    const admin = (await getSecretPreferVault('VAPI_ADMIN_SECRET')) || ADMIN_FALLBACK;
    if (q.secret !== admin) return { statusCode: 401, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'unauthorized - ?secret=' }) };
  }
  try {
    const r = await run({ dry: q.dry === '1', mins: q.mins });
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(r, null, 2) };
  } catch (e) {
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: false, error: String(e.message || e) }, null, 2) };
  }
};
