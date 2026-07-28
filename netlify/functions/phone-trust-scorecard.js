// phone-trust-scorecard — "get better every day" made measurable. Every evening it
// reads the day's calls, scores TRUST honestly (real accuracy/reliability failures vs
// noise like spam + instant hangups), tracks the trend day-over-day, names the #1
// thing to fix next, and texts the owner. Improvement becomes a number with a
// feedback loop, not a vibe. (Teddy 2026-07-24: "I want to get better every day.")
//
//   GET  ?secret=<admin>              -> compute today, store, return JSON
//   GET  ?secret=<admin>&text=1       -> also text the owner the readout
//   GET  ?secret=<admin>&days=7       -> include the last-N-day trend line
//   (scheduled daily ~7PM CT: computes + stores + texts automatically)
'use strict';
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');

const SITE = 'https://tnapplianceexchange.net/.netlify/functions';
const OWNER = '+16154855795';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
function dayCT(ms) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms));
}
function isoDateCT(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// ONE consistent taxonomy so the daily trend is apples-to-apples. Categorizes a
// flagged/clean call from its flags + summary into exactly one bucket.
function categorize(c) {
  const fl = c.flags || [];
  const s = String(c.summary || '').toLowerCase();
  const ended = String(c.ended || '').toLowerCase();
  // Carrier/transport faults are NOT our accuracy — the network never connected.
  if (/transport-never-connected|provider|transport/.test(ended)) return 'carrier_drop';
  if (/\bspam\b|robocall|directory listing|google listing|verification if action/.test(s)) return 'spam';
  if (fl.includes('dropped_or_failed')) return 'lookup_drop';           // silence/timeout mid-lookup — the thing we fixed
  if (/unable to (find|locate)|could ?n[o']t (find|locate)|no match|not able to (find|locate)|we don'?t have/.test(s)) return 'cant_find';
  if (fl.includes('hung_up_fast')) return 'instant_hangup';             // hung up at greeting — not our accuracy
  if (fl.includes('asked_for_human_or_upset') || fl.includes('repeated_human_requests')) return 'human_transfer'; // wanted a person — correct to route
  return 'clean';
}

// Real TRUST failures = things WE got wrong (accuracy/reliability), on calls we could
// actually affect. Noise (spam, instant hangups) + correct human transfers + carrier
// faults are excluded from the denominator so the score reflects real handling.
const REAL_FAIL = new Set(['lookup_drop', 'cant_find', 'wrong_info']);
const NOISE = new Set(['spam', 'instant_hangup', 'carrier_drop']);
const FIX_HINT = {
  lookup_drop: 'lookup drops — keep-warm + timeout guard should cut these; watch they fall',
  cant_find: "couldn't find the caller — lean on name+city + claim lookup, never say \"not in system\"",
  wrong_info: 'wrong info stated — reinforce read-the-tools / never-guess',
  human_transfer: 'many asked for a person — tighten verify/schedule so more self-serve',
  instant_hangup: 'hang-ups at the greeting — consider a shorter opening line',
  spam: 'spam volume — informational only',
};

async function scoreWindow(admin, hours) {
  const r = await fetch(`${SITE}/vapi-admin?secret=${encodeURIComponent(admin)}&action=daycalls&hours=${hours}`, { signal: AbortSignal.timeout(20000) });
  const d = await r.json();
  // INBOUND CUSTOMER calls only. Outbound reminder/confirmation calls hit voicemail
  // and end in "silence-timed-out" — that's not an inbound-trust failure, so scoring
  // them was dragging the number down for calls that worked as intended.
  const calls = ((d && d.calls) || []).filter((c) => c.dir !== 'outbound');
  const outbound_excluded = (((d && d.calls) || []).length) - calls.length;
  const buckets = {};
  for (const c of calls) { const k = categorize(c); buckets[k] = (buckets[k] || 0) + 1; }
  const total = calls.length;
  const noise = Object.entries(buckets).reduce((n, [k, v]) => n + (NOISE.has(k) ? v : 0), 0);
  const actionable = Math.max(0, total - noise);
  const failures = Object.entries(buckets).reduce((n, [k, v]) => n + (REAL_FAIL.has(k) ? v : 0), 0);
  const score = actionable > 0 ? Math.round(100 * (actionable - failures) / actionable) : 100;
  // #1 fix = the biggest real-failure bucket (fall back to the biggest actionable annoyance)
  const ranked = Object.entries(buckets).filter(([k]) => REAL_FAIL.has(k)).sort((a, b) => b[1] - a[1]);
  const topFix = ranked.length ? ranked[0][0] : (buckets.human_transfer ? 'human_transfer' : (buckets.instant_hangup ? 'instant_hangup' : null));
  return { total, actionable, failures, score, buckets, topFix, outbound_excluded };
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const scheduled = !!(event && event.body && (() => { try { return JSON.parse(event.body).next_run; } catch (_) { return false; } })());
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (!scheduled && q.secret !== admin && q.secret !== GUARD_FALLBACK) return json(403, { ok: false, error: 'forbidden' });

  let today;
  try { today = await scoreWindow(admin, 24); }
  catch (e) { return json(200, { ok: false, error: 'score_failed: ' + String((e && e.message) || e) }); }

  const now = Date.now();
  const todayDate = isoDateCT(now);

  // Prior score for the trend (most recent stored score from a DIFFERENT day).
  let prior = null, trendLine = [];
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'phone_trust_score' }, { id: 'desc' }, 30);
    for (const row of (rows || [])) {
      let m = row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
      if (!m || !m.date) continue;
      if (m.date !== todayDate) { trendLine.push({ date: m.date, score: m.score }); if (!prior) prior = m; }
    }
  } catch (_) {}
  trendLine = trendLine.slice(0, Math.max(0, (Number(q.days) || 7) - 1)).reverse();

  // Store today's score (append-only; prior-day reads filter by date so dupes are harmless).
  try { await crud.logEvent('phone_trust_score', { date: todayDate, at_ms: now, score: today.score, total: today.total, actionable: today.actionable, failures: today.failures, buckets: today.buckets, top_fix: today.topFix }); } catch (_) {}

  const delta = prior ? today.score - prior.score : null;
  const arrow = delta == null ? '—' : (delta > 0 ? `▲ +${delta}` : (delta < 0 ? `▼ ${delta}` : '● even'));
  const b = today.buckets;
  const noiseBits = [b.instant_hangup ? `${b.instant_hangup} hangups` : '', b.spam ? `${b.spam} spam` : '', b.carrier_drop ? `${b.carrier_drop} carrier` : ''].filter(Boolean).join(' · ');
  const failBits = Object.entries(b).filter(([k]) => REAL_FAIL.has(k)).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(' · ') || 'none';
  const lines = [
    `📞 Phone Trust — ${dayCT(now)}`,
    `Score: ${today.score}/100  ${arrow}${prior ? ` vs ${prior.date} (${prior.score})` : ''}`,
    `Handled right ${today.actionable - today.failures}/${today.actionable} actionable calls (of ${today.total} total)`,
    `Real misses: ${failBits}`,
    noiseBits ? `Noise (not us): ${noiseBits}` : '',
    today.topFix ? `👉 Fix next: ${FIX_HINT[today.topFix] || today.topFix}` : `✅ No real misses today — hold the line.`,
  ].filter(Boolean);
  const readout = lines.join('\n');

  let texted = false;
  if (scheduled || q.text === '1') {
    try { await sendSms(OWNER, readout, 'owner', 'phone_trust_score'); texted = true; } catch (_) {}
  }

  return json(200, { ok: true, date: todayDate, ...today, prior: prior || null, delta, trend: trendLine.concat([{ date: todayDate, score: today.score }]), texted, readout });
};
