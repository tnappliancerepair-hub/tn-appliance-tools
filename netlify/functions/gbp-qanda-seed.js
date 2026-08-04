// gbp-qanda-seed — seed the Google Business Profile Q&A with keyword-rich,
// owner-answered questions. A complete Q&A section is a "complete profile"
// signal shoppers and Google both reward, and each answer is a natural place
// to rank for "same-day / cost / near me / <city>" intent.
//
// Posts as the authenticated owner: creates the question, then upserts the
// owner's answer (shows the "Owner" badge). Idempotent — skips any question
// whose text already exists on the profile, so re-runs never duplicate.
//
//   GET ?dryrun=1&secret=<admin>   list existing Q&A + show what WOULD post
//   GET ?live=1&secret=<admin>     create the missing questions + owner answers
//
// Kill switch: vault GBP_QANDA_SEED=false. Public phone only (615-280-2949) —
// never the owner cell.
'use strict';
const gbp = require('./_lib/gbp');
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
const QHOST = 'https://mybusinessqanda.googleapis.com/v1';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }

// Curated, keyword-rich, honest owner Q&A. Cash + local + trust intent.
const QA = [
  { q: 'Do you offer same-day appliance repair near me?',
    a: 'Often, yes. Tell us what\'s broken with a quick 10-second video and we route the closest technician — usually same-day across Middle Tennessee and Louisiana. Text or call 615-280-2949 and we text you right back.' },
  { q: 'How much does appliance repair cost?',
    a: 'We quote flat labor by the job plus the exact part at our real cost — no $125–150 mystery service call. Your $50 Quick Check credits straight to the repair, so you never pay twice. See real pricing at tnapplianceexchange.net/appliance-repair-cost.' },
  { q: 'Do you charge a service call or diagnostic fee?',
    a: 'No mystery service call. Start with a $50 Quick Check (or a $100 in-home diagnostic) and that amount credits directly to your repair if you proceed. You pay once.' },
  { q: 'What appliances and brands do you repair?',
    a: 'Refrigerators, washers, dryers, dishwashers, ovens, ranges, cooktops, freezers and ice makers — all major brands including Whirlpool, GE, Samsung, LG, Maytag, Frigidaire, KitchenAid and Bosch.' },
  { q: 'What areas do you serve?',
    a: 'Middle Tennessee — Nashville, Murfreesboro, Antioch, Clarksville, Smyrna and La Vergne — plus Louisiana: New Orleans, Baton Rouge, Hammond and the surrounding areas.' },
  { q: 'Are you licensed and insured?',
    a: 'Yes — licensed, insured and Google Guaranteed. TN Appliance Exchange is a family-owned, technician-led shop, in business since 2012.' },
  { q: 'Can I get a repair price before a technician comes out?',
    a: 'Yes. Send a 10-second video and a photo of the model-number sticker and a real technician sends you honest options, usually within hours, before anyone is dispatched. Start at tnapplianceexchange.net.' },
  { q: 'Is it worth repairing my appliance or should I replace it?',
    a: 'We\'ll tell you straight — even when the answer is "don\'t." A good rule: if the fix costs less than half a comparable new unit and the appliance is under about 8 years old, repair usually wins.' },
];

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let scheduled = false;
  try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  if (String((await getSecret('GBP_QANDA_SEED')) || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });
  if (!(await gbp.isConfigured())) return json(200, { ok: false, error: 'gbp not configured' });

  const dry = q.dryrun === '1' && !scheduled;

  let loc;
  try { loc = (await gbp.resolveAccountLocation()).locationId; } catch (e) { return json(200, { ok: false, error: 'resolve failed: ' + String(e && e.message || e) }); }

  // existing questions (dedup)
  let existing = [];
  try {
    const r = await gbp.api('GET', `${QHOST}/locations/${loc}/questions?pageSize=50&answersPerQuestion=1`);
    if (!r.ok) return json(200, { ok: false, error: 'list questions ' + r.status + ' — Q&A API may not be enabled on the Google Cloud project', detail: String(r.raw || '').slice(0, 300) });
    existing = (r.data && r.data.questions) || [];
  } catch (e) { return json(200, { ok: false, error: 'list failed: ' + String(e && e.message || e) }); }
  const have = new Set(existing.map((x) => norm(x.text)));

  const posted = [], skipped = [], errors = [];
  for (const item of QA) {
    if (have.has(norm(item.q))) { skipped.push({ q: item.q, why: 'already on profile' }); continue; }
    if (dry) { posted.push({ q: item.q, a: item.a, mode: 'DRYRUN' }); continue; }
    try {
      const cr = await gbp.api('POST', `${QHOST}/locations/${loc}/questions`, { text: item.q });
      if (!cr.ok || !(cr.data && cr.data.name)) { errors.push({ q: item.q, why: 'create ' + cr.status + ' ' + String(cr.raw || '').slice(0, 120) }); continue; }
      const ar = await gbp.api('POST', `${QHOST}/${cr.data.name}/answers:upsert`, { answer: { text: item.a } });
      if (!ar.ok) { errors.push({ q: item.q, why: 'answer ' + ar.status + ' ' + String(ar.raw || '').slice(0, 120) }); continue; }
      posted.push({ q: item.q });
      try { await crud.logEvent('gbp_qanda_seeded', { q: item.q, at_ms: Date.now() }); } catch (_) {}
    } catch (e) { errors.push({ q: item.q, why: String(e && e.message || e) }); }
  }

  return json(200, {
    ok: true, mode: dry ? 'dryrun' : 'live', location: loc,
    existing_questions: existing.length, to_post: QA.length - skipped.length,
    posted: posted.length, skipped: skipped.length, errors: errors.length,
    posted_detail: posted, skipped, errors,
  });
};
