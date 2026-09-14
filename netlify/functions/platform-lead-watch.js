// platform-lead-watch — the thing that tells a human a paid lead is sitting untouched.
//
// WHY THIS EXISTS (measured 2026-09-14): of 35 cash web leads in 30 days, NINE of the ten
// that never converted had ZERO outbound messages — nobody ever said a word back. Four sat
// eleven days. All five that got canceled had zero contact. And the live board at the time
// this shipped held a Local Services Ads lead (Jerad Wayburn, Nashville, ice maker) who had
// messaged us TWICE, four hours in, with no reply -- a lead we PAID ~$13 for.
//
// The gap was not the board and not the intake. It was that NOTHING on the platform side
// tells anyone a lead arrived: grep the platform-* functions for a cash-lead alert tag and
// you get nothing. The Xano-side cash-ready-notify runs every 20 minutes and texts NOBODY,
// because its tags (cash_ready_notify / cash_ready_escalate) were never allowlisted in
// _lib/office-gate -- so it has been writing into a void since the 2026-08-28 office-SMS kill.
//
// WHAT IT WATCHES: the DATA, never a function's self-report. A lead is "untouched" when
// BOTH are true:
//   • job.status is still 'new'            (nobody moved it on the board), AND
//   • zero OUTBOUND thread_message         (nobody said a word back)
// Either one being false means a human engaged, and it stays quiet.
//
// ⚠️ FORWARD-ONLY BY CONSTRUCTION. First-touch only ever considers leads younger than
// FIRST_TOUCH_MAX_H. That matters: 30+ of TN's platform leads carry the MIGRATION's
// created_at (all stamped the same hour), so an unbounded first run would have fired
// thirty texts at once. The age floor is the guard, and it needs no bookkeeping.
//
// ⚠️ IT TEXTS TEDDY ONLY -- not Danielle, not Sofia, not Carrie. _lib/office-gate is a
// hard rule (Teddy 2026-08-28: "No more texting Danielle, Sofia or Carrie. Only text me
// cash job intake"). Adding them here would be written and delivered NOWHERE. The tag
// 'platform_cash_lead' is allowlisted in CASH_INTAKE_TAGS for exactly this reason -- an
// un-allowlisted tag is the trap cash-ready-notify fell into.
//
// It NEVER texts the customer. Standing rule: no proactive customer texts. This surfaces
// the lead to a human; the human makes the call.
//
//   GET ?secret=<admin>[&dry=1]   dry=1 lists who WOULD be alerted and texts nobody
'use strict';

const { sendSmsDetailed } = require('./_lib/sms');
const { getSecretPreferVault } = require('./_lib/secrets');

const TN    = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
const SB    = 'https://tntbhfwitytkcoqlejwc.supabase.co';
const SITE  = 'https://tnapplianceexchange.net';
const OWNER = '+16154855795';
const TAG   = 'platform_cash_lead';
const ADMIN_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';   // same constant sb-admin-sql carries

// ALLOWLIST, not a denylist. The first cut denied the known mirror/import sources and let
// everything else through -- which meant every WARRANTY DISPATCH qualified (ahs_email,
// servicepower_email, email_generic_warranty: over a thousand in 30 days). Its first live
// run texted Teddy about three of them. A denylist is wrong here by construction: the next
// vendor source added anywhere in the codebase would silently start paging him too.
//
// The real question is "does a human need to CALL THIS PERSON BACK." That is a LEAD --
// somebody who came to us off the website, an ad, or the phone. A warranty dispatch is not
// a lead; it is assigned work that flows to scheduling and nobody calls back.
const LEAD_SOURCES = new Set(['web_chat', 'lsa_lead', 'platform_lead', 'ann_phone', 'manual', 'quick_check', 'appliance_ai']);
const isLeadSource = (s) => { const v = String(s || ''); return LEAD_SOURCES.has(v) || v.startsWith('ann_'); };

const FIRST_TOUCH_MAX_H = 48;   // older than this is history, never a first touch
const RENAG_H           = 4;    // still silent this long after the first alert -> nag once/day
const MAX_PER_RUN       = 5;    // a burst can never flood; the rest rolls to the next tick
const OPEN_H            = 8;    // business-hours gate, matches cash-ready-notify
const CLOSE_H           = 20;

const json = (s, b) => ({ statusCode: s, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) });

let _key = '';
async function key() {
  if (_key) return _key;
  _key = process.env.PLATFORM_SUPABASE_SERVICE_KEY || (await getSecretPreferVault('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return _key;
}
async function H() { const k = await key(); return { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' }; }

async function q(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: await H(), signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`sb ${r.status} ${path.slice(0, 70)}`);
  return r.json();
}
async function insert(table, row) {
  const r = await fetch(`${SB}/rest/v1/${table}`, {
    method: 'POST', headers: { ...(await H()), Prefer: 'return=minimal' },
    body: JSON.stringify(row), signal: AbortSignal.timeout(12000),
  });
  return r.ok;
}

const ctHour = () => { try { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date())); } catch (_) { return 12; } };
const ctDate = () => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()); } catch (_) { return new Date().toISOString().slice(0, 10); } };
const hoursSince = (iso) => (!iso ? 0 : Math.round((Date.now() - Date.parse(iso)) / 3600000));

// Bare 10 digits -> a tappable tel: link. Platform phones are stored in mixed formats
// (6157673438, +12177210258, 16158874057), so normalize on the last 10 the way
// platform_call_lookup does -- matching the raw string is the documented way to miss.
function tel(p) {
  const d = String(p || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? d.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3') : '';
}
function shorten(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

async function run(opts) {
  const dry = !!(opts && opts.dry);
  if (!(await key())) return { ok: false, error: 'PLATFORM_SUPABASE_SERVICE_KEY not set' };
  if (String(await getSecretPreferVault('PLATFORM_LEAD_WATCH') || '').toLowerCase() === 'false') {
    return { ok: true, disabled: true };
  }
  const hour = ctHour();
  if (!dry && (hour < OPEN_H || hour >= CLOSE_H)) {
    return { ok: true, skipped: `outside ${OPEN_H}a-${CLOSE_H - 12}p CT`, ct_hour: hour };
  }

  const today = ctDate();
  const sinceIso = new Date(Date.now() - FIRST_TOUCH_MAX_H * 3600000).toISOString();

  // Candidates: born on the platform, still status 'new', young enough to be live work.
  // The re-nag pass needs already-alerted jobs too, so pull a wider window and split below.
  const wideIso = new Date(Date.now() - (FIRST_TOUCH_MAX_H + 24 * 14) * 3600000).toISOString();
  const jobs = await q(
    `job?company_id=eq.${TN}&status=eq.new&created_at=gt.${encodeURIComponent(wideIso)}` +
    `&select=id,source,problem,created_at,customer_id,warranty_company,customer:customer_id(first_name,last_name,phone,city)` +
    `&order=created_at.desc&limit=200`
  );

  // Belt and suspenders: the source must be a real lead door AND the job must carry no
  // warranty company. Either alone would have let the 2026-09-14 warranty flood through.
  const live = (jobs || []).filter((j) => isLeadSource(j.source) && !String(j.warranty_company || '').trim());
  if (!live.length) return { ok: true, mode: dry ? 'dry' : 'live', candidates: 0, alerted: 0 };

  // Who has already been alerted / nagged. One read, not one per job.
  const ids = live.map((j) => j.id);
  let events = [];
  try {
    events = await q(`event?company_id=eq.${TN}&type=in.(lead_watch_alerted,lead_watch_nagged)&select=type,entity,payload,created_at&order=created_at.desc&limit=500`);
  } catch (_) {}
  const alertedAt = new Map();   // job id -> first alert time
  const naggedToday = new Set();
  for (const e of events || []) {
    const jid = e.entity || (e.payload && e.payload.job_id);
    if (!jid || !ids.includes(jid)) continue;
    if (e.type === 'lead_watch_alerted') {
      const t = Date.parse(e.created_at) || 0;
      if (!alertedAt.has(jid) || t < alertedAt.get(jid)) alertedAt.set(jid, t);
    } else if (e.type === 'lead_watch_nagged' && e.payload && e.payload.date === today) {
      naggedToday.add(jid);
    }
  }

  // Outbound counts, batched. A lead with ANY outbound has been engaged -- quiet.
  let spoken = new Set();
  try {
    const msgs = await q(`thread_message?company_id=eq.${TN}&direction=eq.out&job_id=in.(${ids.join(',')})&select=job_id&limit=1000`);
    spoken = new Set((msgs || []).map((m) => m.job_id));
  } catch (_) {
    // A failed read must not manufacture "nobody replied" and blast alerts. Fail CLOSED.
    return { ok: false, error: 'outbound read failed - held alerts' };
  }

  const firstTouch = [], nagged = [], quiet = [];
  for (const j of live) {
    if (spoken.has(j.id)) { quiet.push({ job: j.id, why: 'someone replied' }); continue; }
    const ageH = hoursSince(j.created_at);
    const c = j.customer || {};
    const who = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || 'a new caller';
    const row = { job: j.id, who, city: c.city || '', phone: tel(c.phone), source: j.source, age_h: ageH, problem: shorten(j.problem, 60) };

    if (!alertedAt.has(j.id)) {
      if (j.created_at < sinceIso) { quiet.push({ job: j.id, why: `older than ${FIRST_TOUCH_MAX_H}h, not a first touch` }); continue; }
      firstTouch.push(row);
    } else if (!naggedToday.has(j.id) && (Date.now() - alertedAt.get(j.id)) >= RENAG_H * 3600000) {
      nagged.push(row);
    } else {
      quiet.push({ job: j.id, why: naggedToday.has(j.id) ? 'nagged today' : `alerted, <${RENAG_H}h` });
    }
  }

  const sent = [];
  for (const r of [...firstTouch, ...nagged].slice(0, MAX_PER_RUN)) {
    const isNag = nagged.includes(r);
    const reach = r.phone ? `Call ${r.phone}.` : 'No phone on file - open the thread and reply.';
    const head = isNag
      ? `⏰ STILL NO REPLY (${r.age_h}h): ${r.who}`
      : `\u{1f4b5} NEW LEAD, nobody has replied: ${r.who}`;
    const where = r.city ? ` in ${r.city}` : '';
    const msg = `${head}${where} - ${r.problem || 'no detail'}. ${reach} ${SITE}/platform/messages.html`;

    if (dry) { sent.push({ ...r, kind: isNag ? 'nag' : 'first', preview: msg }); continue; }

    const res = await sendSmsDetailed(OWNER, msg, 'owner', TAG);
    // Record the alert regardless of carrier outcome -- otherwise a refused send
    // re-fires the same text every tick. The reason rides along so a silently
    // suppressed alert is visible in the data instead of looking like it went.
    try {
      await insert('event', {
        company_id: TN,
        type: isNag ? 'lead_watch_nagged' : 'lead_watch_alerted',
        entity: r.job,
        payload: { job_id: r.job, who: r.who, source: r.source, age_h: r.age_h, date: today, texted: res.sent, reason: res.reason || '' },
      });
    } catch (_) {}
    sent.push({ ...r, kind: isNag ? 'nag' : 'first', texted: res.sent, reason: res.reason || '' });
  }

  return {
    ok: true, mode: dry ? 'dry' : 'live', ct_hour: hour,
    candidates: live.length,
    first_touch: firstTouch.length, renag: nagged.length,
    sent: sent.length, held_for_next_run: Math.max(0, firstTouch.length + nagged.length - MAX_PER_RUN),
    alerts: sent, quiet: quiet.slice(0, 12),
  };
}

exports.run = run;
exports.handler = async function (event) {
  const q2 = (event && event.queryStringParameters) || {};
  // Vault, then env, then the known constant -- VAPI_ADMIN_SECRET is NOT readable from
  // the function runtime under that name (verified 2026-09-14: the only endpoints that
  // accept it, e.g. sb-admin-sql, do so via their own hardcoded fallback).
  //
  // ⚠️ Deliberately NOT the sibling shape `if (!scheduled && admin && p.secret !== admin)`.
  // That `admin &&` means an empty read OPENS THE DOOR -- which is why
  // platform-migration-watch and platform-tenant-watch answer an unauthenticated caller
  // right now. Read-only health data, so low blast radius, but it is not a gate. This one
  // fails CLOSED.
  const admin = (await getSecretPreferVault('VAPI_ADMIN_SECRET')) || process.env.VAPI_ADMIN_SECRET || ADMIN_FALLBACK;
  if (!admin || q2.secret !== admin) return json(403, { ok: false, error: 'forbidden' });
  try { return json(200, await run({ dry: q2.dry === '1' })); }
  catch (e) { return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) }); }
};
