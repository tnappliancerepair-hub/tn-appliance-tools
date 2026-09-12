// servicepower-auto-accept — CORE (HTTP-callable). Two passes over the ServicePower board:
//
//   1) ACCEPT  — grabs new OPEN SquareTrade dispatches so we never lose an offer to a slow
//                accept. Status-only ACCEPTED (the proven flow). Capacity is wide open, so
//                taking them all is pure upside.
//   2) INTAKE  — lands each call we own on the Supabase board (API-native warranty intake),
//                so a SquareTrade job no longer depends on a dispatch EMAIL arriving AND
//                parsing. SHADOW until the vault flag is flipped (see below).
//
// Split core + thin cron wrapper (servicepower-auto-accept-cron) because a Netlify fn that
// carries a `schedule` block edge-403s on every external HTTP call — which would make the
// ?dryrun=1 shadow check, the only way to eyeball this before it writes, impossible.
//
//   KILL SWITCHES (vault):
//     SERVICEPOWER_AUTO_ACCEPT=false        stop accepting offers
//     SERVICEPOWER_API_INTAKE=false         stop landing jobs on the platform
//     SERVICEPOWER_API_INTAKE_LIVE=true     intake actually WRITES (default: shadow)
//
//   GET ?dryrun=1     show what WOULD be accepted + landed, write nothing
//   GET ?days=N       board lookback (default 6)
//   GET ?intake=0     skip the intake pass entirely
'use strict';
const sp = require('./_lib/servicepower');
const crud = require('./_lib/xano/metadata-crud');
const { getSecret, getSecretFresh } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const { platform } = require('./_lib/platform-rest');
const { createWarrantyJob } = require('./_lib/platform-warranty-db');

const OWNER = '+16154855795';
const OUR_STATES = new Set(['TN', 'LA']);   // safety guard — we only cover TN + LA
const SLUG_DEFAULT = 'tn-appliance-exchange-llc';

// Statuses whose work is OURS and still live, so it belongs on the board. Deliberately
// excludes OPEN (not ours until accepted — the accept pass above promotes those in the
// same run), REJECTED/CANCELED (not ours), and COMPLETED (finished work would land in the
// office's New column as status:'new', which is worse than not landing it at all).
// (Real board vocabulary observed 2026-09-12: ACCEPTED / OPEN / CANCELLED — note the
// double-L, where the WSDL doc says CANCELED. This is an ALLOWLIST for exactly that
// reason: a spelling we don't expect can never accidentally land a job.)
const OURS = new Set(['ACCEPTED', 'RESCHEDULED', 'CLAIMED']);

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function windows(days, chunk) {
  const out = []; const now = Date.now(); const DAY = 86400000;
  const f = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()} 00:00:00`;
  for (let off = 0; off < days; off += chunk) out.push({ from: f(new Date(now - Math.min(off + chunk, days) * DAY)), to: f(new Date(now - off * DAY)) });
  return out;
}
const who = (c) => `${c.first_name || ''} ${c.last_name || ''}`.trim();

// ServicePower fills empty phone fields with "0" (and sometimes a run of zeros), so a
// plain truthy check hands junk to the customer matcher. Mirrors bestPhone() in
// servicepower-contact-backfill (proven live: Mamie Dents -> 225-456-3629) — same
// phone1 -> cell -> phone2 order — plus two guards, and normalizes to the shape the
// platform stores. Take the first candidate that
// normalizes to a real 10-digit US number, in the SAME bare-10-digit shape the email path
// already stores ("7739888733") — otherwise a genuinely new job mints a duplicate customer.
function normPhone() {
  for (const c of arguments) {
    const d = String(c || '').replace(/\D/g, '');
    const t = (d.length === 11 && d[0] === '1') ? d.slice(1) : d;
    if (t.length !== 10) continue;
    if (/^(\d)\1{9}$/.test(t)) continue;          // 0000000000 / 1111111111
    if (t[0] === '0' || t[0] === '1') continue;   // not a valid US area code
    return t;
  }
  return '';
}

// One ServicePower call -> the normalized job shape createWarrantyJob() takes.
//
// THE KEY (measured 2026-09-12 on the live board, not assumed): ServicePower issues a NEW
// call number per trip, and the dispatch-email path ALREADY writes that call number into
// `claim_number` — 375 jobs, 375 distinct keys, 1:1. So writing call_number -> claim_number
// here means the API path and the email path DEDUP AGAINST EACH OTHER on one column.
// Whichever arrives first wins; the second is a no-op. They cannot duplicate each other.
//
// ⚠️ The older note that "claim_number covers more than one job 23% of the time" measured
// the LEGACY Xano rows, where that column holds the SquareTrade CLAIM — an umbrella across
// trips. Two different values live in one column. The per-trip value is the call number.
function toJob(c) {
  const appliance = String(c.product || '').trim();
  return {
    source: 'servicepower_api',
    // SquareTrade is Allstate's protection arm and our only ServicePower manufacturer
    // (mfg_id rides on the payload if that ever stops being true). Spelled exactly as the
    // email path spells it so the board's vendor split stays one bucket, not two.
    warranty_company: 'SquareTrade',
    claim_number: String(c.call_number || '').trim(),
    dispatch_id: String(c.call_number || '').trim(),
    first: String(c.first_name || '').trim(),
    last: String(c.last_name || '').trim(),
    phone: normPhone(c.phone1, c.cell, c.phone2),
    email: String(c.email || '').trim(),
    address: [c.address1, c.address2].map((x) => String(x || '').trim()).filter(Boolean).join(' ').trim(),
    city: String(c.city || '').trim(),
    state: String(c.state || '').trim().toUpperCase(),
    zip: String(c.zip || '').trim(),
    brand: String(c.brand || '').trim(),
    appliance,
    model: String(c.model || '').trim(),
    serial: String(c.serial || '').trim(),
    problem: String(c.problem || '').trim(),
    service_window: [c.schedule_date, c.schedule_time].map((x) => String(x || '').trim()).filter(Boolean).join(' ').trim(),
  };
}

async function runAutoAccept(opts) {
  const o = opts || {};
  const dry = !!o.dry;
  const days = Math.min(parseInt(o.days || 6, 10) || 6, 30);
  const budgetMs = parseInt(o.budgetMs || 22000, 10) || 22000;
  const wantIntake = o.intake !== false;

  if (String(await getSecret('SERVICEPOWER_AUTO_ACCEPT') || '').toLowerCase() === 'false') {
    return { ok: true, disabled: true, note: 'kill switch on (SERVICEPOWER_AUTO_ACCEPT=false)' };
  }
  if (!(await sp.isConfigured())) return { ok: false, error: 'ServicePower creds missing' };

  const startMs = Date.now();
  const ACCEPT_BUDGET = Math.floor(budgetMs * 0.55);   // leave room for the intake pass

  // 1) gather calls from the board (getCallInfo carries fss_call_id + mfg_id we need)
  const board = new Map();
  try {
    for (const w of windows(days, 2)) {
      if (Date.now() - startMs > ACCEPT_BUDGET) break;
      const r = await sp.getCallInfo({ fromDateTime: w.from, toDateTime: w.to });
      for (const c of (r.calls || [])) {
        if (!c.call_number) continue;
        if (!board.has(c.call_number)) board.set(c.call_number, c);
      }
    }
  } catch (e) { return { ok: false, error: 'board pull failed: ' + String((e && e.message) || e) }; }

  const inOurStates = (c) => !c.state || OUR_STATES.has(String(c.state).toUpperCase());
  const open = [...board.values()].filter((c) => String(c.status || '').toUpperCase() === 'OPEN');

  // 2) accept each OPEN call in our states
  const candidates = open.filter(inOurStates);
  const accepted = [], failed = [], skipped = [];
  const acceptedNow = new Set();
  for (const c of candidates) {
    if (Date.now() - startMs > ACCEPT_BUDGET) break;
    if (dry) { accepted.push({ call: c.call_number, who: who(c), appliance: c.brand || c.product, city: c.city, state: c.state }); acceptedNow.add(c.call_number); continue; }
    if (!c.fss_call_id || !c.mfg_id) { skipped.push({ call: c.call_number, why: 'no fss/mfg' }); continue; }
    let res; try { res = await sp.updateCallInfo({ callNumber: c.call_number, callStatus: 'ACCEPTED', spCallStatusId: '3', fssCallId: c.fss_call_id, mfgId: c.mfg_id }); }
    catch (e) { failed.push({ call: c.call_number, error: String((e && e.message) || e) }); continue; }
    if (res.ok) {
      accepted.push({ call: c.call_number, who: who(c), appliance: c.brand || c.product, city: c.city, state: c.state });
      acceptedNow.add(c.call_number);
      try { await crud.logEvent('sp_auto_accepted', { call: c.call_number, who: who(c), city: c.city, state: c.state, appliance: c.brand || c.product, fss: c.fss_call_id, at_ms: Date.now() }); } catch (_) {}
    } else failed.push({ call: c.call_number, err_code: res.err_code, err_desc: res.err_desc });
  }

  // 3) API-NATIVE INTAKE — land every call we own on the Supabase board.
  //
  // Deliberately NOT limited to the calls accepted in THIS run. The accept pass only ever
  // sees OPEN calls; once accepted they read ACCEPTED forever and would never be revisited.
  // Sweeping the whole window instead means a shadow day, a failed insert, a missed cron or
  // a job that arrived already-accepted all self-heal on the next tick — the same
  // idempotent-rescan discipline the email tee runs on (createWarrantyJob dedupes, so a
  // re-scan costs one indexed lookup per call).
  let intake = null;
  if (wantIntake) intake = await runIntake({ board, acceptedNow, inOurStates, dry, startMs, budgetMs });

  // 4) text Teddy a digest of what was grabbed
  if (!dry && accepted.length) {
    const body = `[ant] ✅ Auto-accepted ${accepted.length} SquareTrade job${accepted.length === 1 ? '' : 's'}:\n`
      + accepted.slice(0, 8).map((a) => `  • ${a.who || a.call} · ${a.appliance || ''} · ${a.city || ''} ${a.state || ''}`).join('\n');
    try { await sendSms(OWNER, body, 'owner', 'sp_auto_accept'); } catch (_) {}
  }

  return {
    ok: true, mode: dry ? 'dryrun' : 'live',
    board_size: board.size, open_found: open.length,
    accepted: accepted.length, failed: failed.length, skipped: skipped.length,
    accepted_list: accepted, failed_list: failed.slice(0, 5),
    intake,
  };
}

async function runIntake(ctx) {
  const { board, acceptedNow, inOurStates, dry, startMs, budgetMs } = ctx;
  const out = { enabled: true, live: false, considered: 0, created: 0, deduped: 0, skipped: 0, errors: 0, results: [] };

  if (String((await getSecretFresh('SERVICEPOWER_API_INTAKE')) || 'true').toLowerCase() === 'false') {
    return { enabled: false, note: 'SERVICEPOWER_API_INTAKE=false' };
  }
  // SHADOW BY DEFAULT. Teddy 2026-09-12: watch it agree with the email path for a day
  // before it writes. A shadow row reports whether the board ALREADY has this call — which
  // is exactly the agreement check (existing_source tells you which path got there first).
  const live = !dry && String((await getSecretFresh('SERVICEPOWER_API_INTAKE_LIVE')) || '').toLowerCase() === 'true';
  out.live = live;

  const db = await platform();
  if (!db) return { enabled: true, live, error: 'platform creds not vaulted' };

  const slug = (await getSecretFresh('SERVICEPOWER_API_INTAKE_SLUG')) || SLUG_DEFAULT;
  let co = null;
  try { co = (await db.get(`company?slug=eq.${encodeURIComponent(slug)}&select=id,name,trade,settings&limit=1`))[0]; } catch (_) {}
  if (!co) return { enabled: true, live, error: 'company not found for slug ' + slug };
  out.company = co.name;

  const ours = [...board.values()].filter((c) => inOurStates(c)
    && (OURS.has(String(c.status || '').toUpperCase()) || acceptedNow.has(c.call_number)));
  out.considered = ours.length;

  for (const c of ours) {
    if (Date.now() - startMs > budgetMs) { out.skipped++; continue; }
    const n = toJob(c);
    const brief = { call: n.claim_number, who: [n.first, n.last].filter(Boolean).join(' '), appliance: n.appliance, city: n.city, state: n.state, status: String(c.status || '').toUpperCase() };
    if (!n.claim_number) { out.skipped++; out.results.push({ ...brief, skipped: 'no call number' }); continue; }
    try {
      // Read the board the same way createWarrantyJob's own dedup does, so a shadow run
      // reports the identical decision the live run would make.
      const dup = await db.get(`job?company_id=eq.${co.id}&claim_number=eq.${encodeURIComponent(n.claim_number)}&select=id,source&limit=1`);
      const existing = dup && dup[0];
      if (!live) {
        if (existing) { out.deduped++; out.results.push({ ...brief, would: 'dedup', job_id: existing.id, existing_source: existing.source }); }
        else { out.created++; out.results.push({ ...brief, would: 'create', phone: n.phone || null, model: n.model || null, window: n.service_window || null }); }
        continue;
      }
      const r = await createWarrantyJob(db, co, n);
      if (r.deduped) { out.deduped++; out.results.push({ ...brief, status_out: 'deduped', job_id: r.job_id }); }
      else {
        out.created++; out.results.push({ ...brief, status_out: 'created', job_id: r.job_id });
        try { await crud.logEvent('sp_api_intake_created', { call: n.claim_number, job_id: r.job_id, who: brief.who, city: n.city, state: n.state, appliance: n.appliance, at_ms: Date.now() }); } catch (_) {}
      }
    } catch (e) { out.errors++; out.results.push({ ...brief, error: String((e && e.message) || e).slice(0, 140) }); }
  }
  return out;
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  // This used to be a SCHEDULED fn, where Netlify's edge-403 was the de-facto gate. Now
  // that it's HTTP-callable (so the shadow check works), it needs a real one — accepting
  // dispatches and writing jobs is not something an anonymous caller gets to trigger.
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'admin secret required (?secret=)' });
  const res = await runAutoAccept({ dry: q.dryrun === '1', days: q.days, intake: q.intake !== '0' });
  return json(200, res);
};

exports.runAutoAccept = runAutoAccept;
