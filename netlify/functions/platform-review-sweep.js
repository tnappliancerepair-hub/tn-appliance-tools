// platform-review-sweep — the automatic "leave us a review" ask, plus ONE nudge.
// For EVERY platform shop, finds jobs completed recently and texts the customer that shop's
// review request — but ONLY if the shop left the review template ON in its Communication
// Center (company.settings.comms.review). Per-job dedupe so a customer is asked once, ever.
// This is what makes "review requests go to ALL your customers" true automatically, as jobs
// complete — the tech/office ⭐ button is the on-demand version of the same send.
//
//   GET/POST ?secret=<admin>        run now
//   &dry=1                          shadow — log who WOULD get asked, send nothing
//   &company=<id>                   scope to one shop (testing)
//   &hours=<n>                      look-back window (default 48h — the cron runs every 2h, so
//                                   48h is pure slack against a missed run; dedup makes the
//                                   overlap free. Raise only for a deliberate catch-up.
//   scheduled (Netlify cron)        self-authorizes via {next_run}
//
// THE LINK GATE (2026-09-09): a review ask is only sent when the shop's review link can actually
// TAKE a review. An unset link used to fall back to a Google *search* URL — the customer landed on
// results and had to hunt for the write-a-review box, so the ask converted at ~nothing AND burned
// the one ask we get per job. Now: no usable link -> skipped_no_link, nothing sent, and the shop
// is named in the output so the owner can be told to paste their link (GBP -> Ask for reviews ->
// Copy link). Measured 2026-09-09: 0 of 12 platform shops had one set.
//
// THE NUDGE: one gentle second ask ~3 days later, only to customers who never replied, only if the
// shop left review_nudge on. Capped at one, ever — dedup marker channel=review_nudge.
//
// LIVE gate: real sends happen ONLY when vault PLATFORM_REVIEW_SWEEP_LIVE=1 (or ?live=1 with
// the admin secret). Default = SHADOW (logs the would-send list, texts no one) so turning the
// automatic mass ask on is a deliberate flip — never an accidental blast of the back-book.
// Forward-only by the window: only jobs completed within the last N hours are considered, so
// it can't retro-blast years of history; a one-time full-book campaign is a separate decision.
'use strict';
const { getSecret, getSecretFresh } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const { commsFor, render, reviewLink, REVIEW_LINK_HELP } = require('./_lib/comms');
const { claimSend, onceKey } = require('./_lib/send-once');
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
exports.config = { timeout: 26 };
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

async function ctx() {
  const base = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { base, H: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } };
}
async function sget(base, H, path) { try { const r = await fetch(base + '/rest/v1/' + path, { headers: H, signal: AbortSignal.timeout(9000) }); return r.ok ? (await r.json().catch(() => [])) : []; } catch (_) { return []; } }
async function sins(base, H, table, row) { try { await fetch(base + '/rest/v1/' + table, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(9000) }); } catch (_) {} }

async function runSweep(opts) {
  const dry = !!(opts && opts.dry);
  // getSecretFresh so flipping the LIVE flag / a shop's toggle takes effect next run.
  const liveFlag = String((await getSecretFresh('PLATFORM_REVIEW_SWEEP_LIVE')) || '').trim() === '1';
  const live = !dry && (liveFlag || !!(opts && opts.forceLive));
  const hours = Math.max(1, parseInt((opts && opts.hours) || '48', 10) || 48);
  const sinceIso = new Date(Date.now() - hours * 3600000).toISOString();

  const { base, H } = await ctx();
  if (!base || !H.apikey) return { ok: false, error: 'platform_not_configured' };

  // Jobs completed within the window. completed_at is stamped when the tech marks a job done
  // (tech.html / tech-job.html). Forward-only by the window; dedup makes re-scan cheap + safe.
  let jf = `job?status=eq.completed&completed_at=gte.${encodeURIComponent(sinceIso)}&select=id,company_id,customer_id,technician_id&order=completed_at.desc&limit=1000`;
  if (opts && opts.company) jf += `&company_id=eq.${encodeURIComponent(opts.company)}`;
  const jobs = await sget(base, H, jf);

  const coCache = {}, techCache = {};
  const out = {
    ok: true, mode: live ? 'live' : 'shadow', since: sinceIso, found: jobs.length,
    sent: 0, nudged: 0, send_failed: 0,
    skipped_off: 0, skipped_dup: 0, skipped_nophone: 0, skipped_no_link: 0,
    shops_missing_link: [], results: [],
  };

  async function company(id) {
    if (!coCache[id]) coCache[id] = (await sget(base, H, `company?id=eq.${id}&select=name,settings&limit=1`))[0] || {};
    return coCache[id];
  }
  async function techFirst(id) {
    if (!id) return 'your tech';
    if (techCache[id] === undefined) {
      const t = (await sget(base, H, `technician?id=eq.${id}&select=name&limit=1`))[0];
      techCache[id] = String((t && t.name) || '').trim().split(/\s+/)[0] || '';
    }
    return techCache[id] || 'your tech';
  }
  // Mark a shop as blocked on its review link — once, with the plain-English reason.
  function noteMissingLink(shop, why) {
    if (!out.shops_missing_link.some((m) => m.shop === shop)) {
      out.shops_missing_link.push({ shop, reason: REVIEW_LINK_HELP[why] || why });
    }
  }

  // ---------- pass 1: the ask ----------
  for (const j of jobs) {
    if (out.sent >= 500) break;
    const co = await company(j.company_id);
    const settings = co.settings || {};
    const shop = co.name || 'your appliance shop';
    const rc = commsFor(settings, 'review');
    if (!rc.on) { out.skipped_off++; continue; }

    // THE GATE: never spend the one ask on a link that cannot take a review.
    const rl = reviewLink(settings);
    if (!rl.ok) { out.skipped_no_link++; noteMissingLink(shop, rl.why); continue; }

    // per-job dedupe — one review ask ever. Cheap pre-filter only: the ⭐ button now claims
    // the SAME send_key this sweep does, so the real guarantee is the database, not this read.
    const dupe = await sget(base, H, `thread_message?job_id=eq.${j.id}&channel=eq.review&select=id&limit=1`);
    if (dupe && dupe.length) { out.skipped_dup++; continue; }

    const cus = (await sget(base, H, `customer?id=eq.${j.customer_id}&select=first_name,phone&limit=1`))[0] || {};
    const phone = String(cus.phone || '').trim();
    const text = render(rc.text, { first: cus.first_name || 'there', shop, tech: await techFirst(j.technician_id), review: rl.url });

    out.results.push({ job: j.id, shop, kind: 'ask', to: phone ? '…' + phone.slice(-4) : '(no phone)' });
    if (!phone) { out.skipped_nophone++; continue; }
    if (!live) { out.sent++; continue; }   // shadow — counts as "would send", texts no one

    // CLAIM BEFORE SEND (2026-09-10). The dupe read above is only a cheap pre-filter; it is
    // this row that decides. The manual ⭐ button writes the SAME key, so the button and this
    // cron contend on one database row and exactly one of them can ever text the customer —
    // which is the documented double-ask bug, closed structurally instead of by convention.
    const claimed = await claimSend(base, H, { company_id: j.company_id, customer_id: j.customer_id, job_id: j.id, direction: 'out', channel: 'review', sender: 'system', body: '⭐ Review request sent: ' + rl.url }, onceKey('review', j.id));
    if (!claimed) { out.skipped_dup++; continue; }
    let ok = false; try { ok = await sendSms(phone, text, 'customer', 'platform_review'); } catch (_) {}
    if (ok) out.sent++; else out.send_failed = (out.send_failed || 0) + 1;
  }

  // ---------- pass 2: ONE nudge, 3 days after the ask, only if they never replied ----------
  // We cannot see whether a customer actually left a review (Google has no per-customer API), so
  // the nudge is time-based and worded to be harmless to someone who already did. Capped at one.
  const nudgeAfterMs = 72 * 3600000, nudgeWindowMs = 14 * 24 * 3600000;
  let af = `thread_message?channel=eq.review&direction=eq.out&created_at=lte.${encodeURIComponent(new Date(Date.now() - nudgeAfterMs).toISOString())}&created_at=gte.${encodeURIComponent(new Date(Date.now() - nudgeWindowMs).toISOString())}&select=job_id,company_id,customer_id,created_at&order=created_at.desc&limit=500`;
  if (opts && opts.company) af += `&company_id=eq.${encodeURIComponent(opts.company)}`;
  const asked = await sget(base, H, af);

  for (const a of asked) {
    if (out.nudged >= 200) break;
    const co = await company(a.company_id);
    const settings = co.settings || {};
    const shop = co.name || 'your appliance shop';
    const nc = commsFor(settings, 'review_nudge');
    if (!nc.on) { out.skipped_off++; continue; }

    const rl = reviewLink(settings);
    if (!rl.ok) { out.skipped_no_link++; noteMissingLink(shop, rl.why); continue; }

    // one nudge ever
    const done = await sget(base, H, `thread_message?job_id=eq.${a.job_id}&channel=eq.review_nudge&select=id&limit=1`);
    if (done && done.length) { out.skipped_dup++; continue; }

    // if they said anything back since the ask, a human owns it — never nudge over a live reply
    const replied = await sget(base, H, `thread_message?job_id=eq.${a.job_id}&direction=eq.in&created_at=gte.${encodeURIComponent(a.created_at)}&select=id&limit=1`);
    if (replied && replied.length) { out.skipped_dup++; continue; }

    const cus = (await sget(base, H, `customer?id=eq.${a.customer_id}&select=first_name,phone&limit=1`))[0] || {};
    const phone = String(cus.phone || '').trim();
    const job = (await sget(base, H, `job?id=eq.${a.job_id}&select=technician_id&limit=1`))[0] || {};
    const text = render(nc.text, { first: cus.first_name || 'there', shop, tech: await techFirst(job.technician_id), review: rl.url });

    out.results.push({ job: a.job_id, shop, kind: 'nudge', to: phone ? '…' + phone.slice(-4) : '(no phone)' });
    if (!phone) { out.skipped_nophone++; continue; }
    if (!live) { out.nudged++; continue; }

    const nclaimed = await claimSend(base, H, { company_id: a.company_id, customer_id: a.customer_id, job_id: a.job_id, direction: 'out', channel: 'review_nudge', sender: 'system', body: '⭐ Review nudge sent: ' + rl.url }, onceKey('review_nudge', a.job_id));
    if (!nclaimed) { out.skipped_dup++; continue; }
    let ok = false; try { ok = await sendSms(phone, text, 'customer', 'platform_review_nudge'); } catch (_) {}
    if (ok) out.nudged++; else out.send_failed = (out.send_failed || 0) + 1;
  }

  console.log('[review-sweep]', JSON.stringify({ mode: out.mode, found: out.found, sent: out.sent, nudged: out.nudged, send_failed: out.send_failed, off: out.skipped_off, dup: out.skipped_dup, no_link: out.skipped_no_link }));
  return out;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const guard = (await getSecret('ADMIN_SECRET')) || (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (!scheduled && q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });
  const res = await runSweep({ dry: !!q.dry, company: q.company, hours: q.hours, forceLive: q.live === '1' && q.secret === guard });
  return json(200, res);
};

exports.runSweep = runSweep;
