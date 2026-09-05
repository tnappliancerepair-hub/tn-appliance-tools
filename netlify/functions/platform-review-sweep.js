// platform-review-sweep — the automatic "how did we do? leave us a review" ask.
// For EVERY platform shop, finds jobs completed recently and texts the customer that shop's
// review request — but ONLY if the shop left the review template ON in its Communication
// Center (company.settings.comms.review). Per-job dedupe so a customer is asked once, ever.
// This is what makes "review requests go to ALL your customers" true automatically, as jobs
// complete — the tech/office ⭐ button is the on-demand version of the same send.
//
//   GET/POST ?secret=<admin>        run now
//   &dry=1                          shadow — log who WOULD get asked, send nothing
//   &company=<id>                   scope to one shop (testing)
//   &hours=<n>                      look-back window (default 72h)
//   scheduled (Netlify cron)        self-authorizes via {next_run}
//
// LIVE gate: real sends happen ONLY when vault PLATFORM_REVIEW_SWEEP_LIVE=1 (or ?live=1 with
// the admin secret). Default = SHADOW (logs the would-send list, texts no one) so turning the
// automatic mass ask on is a deliberate flip — never an accidental blast of the back-book.
// Forward-only by the window: only jobs completed within the last N hours are considered, so
// it can't retro-blast years of history; a one-time full-book campaign is a separate decision.
'use strict';
const { getSecret, getSecretFresh } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const { commsFor, render } = require('./_lib/comms');
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
  const hours = Math.max(1, parseInt((opts && opts.hours) || '72', 10) || 72);
  const sinceIso = new Date(Date.now() - hours * 3600000).toISOString();

  const { base, H } = await ctx();
  if (!base || !H.apikey) return { ok: false, error: 'platform_not_configured' };

  // Jobs completed within the window. completed_at is stamped when the tech marks a job done
  // (tech.html / tech-job.html). Forward-only by the window; dedup makes re-scan cheap + safe.
  let jf = `job?status=eq.completed&completed_at=gte.${encodeURIComponent(sinceIso)}&select=id,company_id,customer_id&order=completed_at.desc&limit=1000`;
  if (opts && opts.company) jf += `&company_id=eq.${encodeURIComponent(opts.company)}`;
  const jobs = await sget(base, H, jf);

  const coCache = {};
  const out = { ok: true, mode: live ? 'live' : 'shadow', since: sinceIso, found: jobs.length, sent: 0, skipped_off: 0, skipped_dup: 0, skipped_nophone: 0, results: [] };

  for (const j of jobs) {
    if (out.sent >= 500) break;
    let co = coCache[j.company_id];
    if (!co) { co = (await sget(base, H, `company?id=eq.${j.company_id}&select=name,settings&limit=1`))[0] || {}; coCache[j.company_id] = co; }
    const rc = commsFor(co.settings || {}, 'review');
    if (!rc.on) { out.skipped_off++; continue; }

    // per-job dedupe — one review ask ever (this sweep marks channel=review; the on-demand
    // ⭐ button logs channel=sms, so if a human already asked via the button, that won't collide
    // here, but a shop typically uses one path — the marker prevents the sweep re-asking).
    const dupe = await sget(base, H, `thread_message?job_id=eq.${j.id}&channel=eq.review&select=id&limit=1`);
    if (dupe && dupe.length) { out.skipped_dup++; continue; }

    const cus = (await sget(base, H, `customer?id=eq.${j.customer_id}&select=first_name,phone&limit=1`))[0] || {};
    const phone = String(cus.phone || '').trim();
    const settings = co.settings || {};
    const shop = co.name || 'your appliance shop';
    const reviewUrl = String(settings.review_url || '').trim() || `https://www.google.com/search?q=${encodeURIComponent(shop + ' reviews')}`;
    const text = render(rc.text, { first: cus.first_name || 'there', shop, review: reviewUrl });

    out.results.push({ job: j.id, shop, to: phone ? '…' + phone.slice(-4) : '(no phone)' });
    if (!phone) { out.skipped_nophone++; continue; }
    if (!live) { out.sent++; continue; }   // shadow — counts as "would send", texts no one

    let ok = false; try { ok = await sendSms(phone, text, 'customer', 'platform_review'); } catch (_) {}
    await sins(base, H, 'thread_message', { company_id: j.company_id, customer_id: j.customer_id, job_id: j.id, direction: 'out', channel: 'review', sender: 'system', body: '⭐ Review request sent: ' + reviewUrl });
    if (ok) out.sent++;
  }
  console.log('[review-sweep]', JSON.stringify({ mode: out.mode, found: out.found, sent: out.sent, off: out.skipped_off, dup: out.skipped_dup }));
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
