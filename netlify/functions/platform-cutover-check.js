// platform-cutover-check — one honest answer to "what breaks if Xano goes dark tomorrow?"
//
// TN's data reaches the platform today by MIRROR: every lane starts in Xano and gets
// copied across. That means the platform looks complete while being entirely
// dependent - turn Xano off and the board stops receiving, even though it's full.
//
// So the number that actually matters is not how many jobs are on the platform. It is
// how many jobs were BORN there. A job with no xano_id came in through a platform lane
// and would have arrived with Xano switched off. That count going up is the cutover;
// everything else is preparation.
//
// The cutover pattern per lane is always the same three steps:
//   1. DUAL-FEED  - point the source at the platform TOO, so both receive
//   2. COMPARE    - run both for a week and diff what each one caught
//   3. DROP XANO  - turn off the Xano side of that one lane
// Never more than one lane in flight at a time, so a bad week has one suspect.
//
//   GET ?secret=<admin>          the scoreboard
//   GET ?secret=…&days=14        how far back to look for born-here jobs
'use strict';

const { getSecret } = require('./_lib/secrets');

const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f'; // TN Appliance Exchange LLC - the keeper
const TN_SLUG = 'tn-appliance-exchange-llc';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized - ?secret=' });
  const days = Math.max(1, Math.min(90, parseInt(q.days, 10) || 14));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!url || !key) return json(200, { ok: false, error: 'platform not configured' });
  const base = String(url).replace(/\/+$/, '');
  const H = { apikey: key, Authorization: 'Bearer ' + key };

  // Exact counts via Content-Range - a select-all is capped at ~1000 rows and would
  // quietly under-report a tenant this size.
  async function count(path) {
    try {
      const r = await fetch(`${base}/rest/v1/${path}`, { method: 'HEAD', headers: { ...H, Prefer: 'count=exact', Range: '0-0' }, signal: AbortSignal.timeout(9000) });
      return parseInt(((r.headers.get('content-range') || '').split('/')[1] || '0'), 10) || 0;
    } catch (_) { return null; }
  }
  async function rows(path) {
    try {
      const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(9000) });
      return r.ok ? await r.json() : [];
    } catch (_) { return []; }
  }

  const co = `company_id=eq.${TN_COMPANY}`;
  const [total, mirrored, bornHere, bornRecent, recentAll, emailIntake, tdrs, invoices] = await Promise.all([
    count(`job?${co}&select=id`),
    count(`job?${co}&xano_id=not.is.null&select=id`),
    count(`job?${co}&xano_id=is.null&select=id`),
    count(`job?${co}&xano_id=is.null&created_at=gte.${since}&select=id`),
    count(`job?${co}&created_at=gte.${since}&select=id`),
    count(`email_intake?${co}&select=id`),
    count(`job_tdr?${co}&select=id`),
    count(`invoice?${co}&select=id`),
  ]);

  // Freshest mirrored job tells us the mirror is alive; freshest born-here job tells us
  // whether any platform lane is actually receiving.
  const newestAny = await rows(`job?${co}&select=created_at&order=created_at.desc&limit=1`);
  const newestBorn = await rows(`job?${co}&xano_id=is.null&select=created_at,source&order=created_at.desc&limit=1`);

  // Which platform lanes could carry TN today, judged by evidence rather than intent.
  const settingsRows = await rows(`company?id=eq.${TN_COMPANY}&select=slug,name,settings`);
  const st = (settingsRows && settingsRows[0]) || {};
  const phone = (st.settings && st.settings.phone) || {};
  const texting = (st.settings && st.settings.texting) || {};

  const lanes = [
    {
      lane: 'Warranty dispatch email (AHS / ServicePower / SquareTrade)',
      platform_ready: true,
      receiving_now: (emailIntake || 0) > 0,
      how_to_dual_feed: `Add a forward rule in the warranty inbox to ${TN_SLUG}@jobs.assistant247.net. Xano's pollers keep running; both sides receive the same dispatch.`,
      why_it_matters: 'This is the biggest lane - most of TN\'s work arrives this way. Nothing else can be cut until this one stands alone.',
    },
    {
      lane: 'Phone (Ann answers, books onto the board)',
      platform_ready: true,
      receiving_now: !!phone.number,
      how_to_dual_feed: 'platform-phone action=provision gives TN a platform Ann on its own number. Point one published number at it and listen to a week of real calls before moving the main line.',
      why_it_matters: 'The platform brain is live for other tenants. TN is the one shop still on the Xano Ann.',
    },
    {
      lane: 'Customer texts (inbound)',
      platform_ready: true,
      receiving_now: false,
      how_to_dual_feed: 'Needs the 10DLC registration filed for TN, then a tenant messaging profile pointed at platform-sms-inbound. Built today, never carried a real tenant.',
      why_it_matters: 'Texting is how customers actually answer. Voice can cut over without it; the shop cannot run on it long-term.',
      blocked_by: texting.status === 'approved' ? null : 'TN has no carrier registration on the platform yet (settings.texting = ' + (texting.status || 'not_started') + ')',
    },
    {
      lane: 'Web + AI intake (appliance-ai.html)',
      platform_ready: true,
      receiving_now: false,
      how_to_dual_feed: 'platform-lead already accepts a lead by slug. Point the intake submit at it alongside the Xano call.',
      why_it_matters: 'Low volume next to warranty email, and the easiest lane to dual-feed - a good one to practise the pattern on.',
    },
    {
      lane: 'Warranty claim submission (ServicePower)',
      // The BUILD is platform-native now (_lib/platform-claim-context): job, customer, TDR
      // and parts all come off Supabase, and the claim's returned flag is derived from the
      // vendor's own must_return rather than from whether a parts email happened to parse.
      // Not calling this "receiving" -- nothing files automatically, by choice.
      platform_ready: true,
      receiving_now: false,
      how_to_dual_feed: 'servicepower-claims-build already assembles the claim off the platform (source:platform). Preview one against a real dispatch and diff it with ?src=xano before anything files.',
      why_it_matters: 'This is the money lane - an unfiled claim is an unpaid job. The assembly no longer needs Xano; what is left is the official defect/repair code lists and the decision to let it file on its own.',
    },
    {
      lane: 'Money (invoices, payroll, tech pay)',
      platform_ready: true,
      receiving_now: (invoices || 0) > 0,
      how_to_dual_feed: 'The platform invoice + tech-pay spine exists and is used by other tenants. TN needs to bill one real job there and check the number against Xano.',
      why_it_matters: 'Techs get paid off this. It has to be right before anyone trusts it.',
    },
  ];

  const nextFlip = lanes.find((l) => l.platform_ready && !l.receiving_now && !l.blocked_by) || lanes.find((l) => !l.platform_ready);

  // Five tenants answer to some form of "TN" and only one is real. Somebody logging
  // into the wrong one during a cutover is a very believable bad afternoon.
  const allCos = await rows('company?select=id,slug,name&limit=200');
  const tnLike = (allCos || []).filter((c) => /^(tn|tn-)/i.test(String(c.slug || ''))).map((c) => ({
    slug: c.slug, name: c.name, keeper: c.id === TN_COMPANY,
  }));

  return json(200, {
    ok: true,
    tenant: { slug: st.slug || TN_SLUG, name: st.name || 'TN Appliance Exchange LLC', company_id: TN_COMPANY },
    the_number_that_matters: {
      jobs_born_on_the_platform: bornHere,
      born_here_in_last_days: { days, count: bornRecent },
      newest_born_here: (newestBorn && newestBorn[0]) || null,
      reading: bornHere > 0
        ? 'Some jobs are arriving through platform lanes. Cutover has started.'
        : 'Every job on the board came from Xano. The platform is complete and completely dependent - turning Xano off today stops the board receiving.',
    },
    mirror: {
      total_jobs: total, mirrored_from_xano: mirrored, jobs_last_days: { days, count: recentAll },
      newest_job_at: (newestAny && newestAny[0] && newestAny[0].created_at) || null,
    },
    depth: { tdrs: tdrs, invoices: invoices, warranty_emails_received: emailIntake },
    lanes,
    next_flip: nextFlip ? nextFlip.lane : 'every lane is receiving - compare a week, then start dropping Xano',
    method: 'One lane at a time: dual-feed, compare for a week, then drop the Xano side. Never two lanes in flight, so a bad week has one suspect.',
    tenant_hygiene: {
      tn_like_tenants: tnLike,
      note: tnLike.length > 1 ? 'More than one tenant answers to TN. Retire the extras before cutover - logging into the wrong board on go-live day is a very believable bad afternoon.' : 'clean',
    },
  });
};
