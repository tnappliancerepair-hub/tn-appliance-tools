// platform-usage-digest — once-daily, notify each shop OWNER of their month-to-date
// usage: call minutes + texts vs their plan's included amount. Customer-framed on
// purpose — NEVER cost / margin / the underlying provider (that stays ours). This is
// the interface that lets us keep the phone provider a black box: the owner learns
// their usage from US, against THEIR plan, not from a Telnyx dashboard.
//
// SHADOW-first + safe: skips tenants with zero usage (no $0 emails), dedupes once/day,
// and only actually emails when PLATFORM_USAGE_DIGEST_LIVE=true (and send-email's own
// EMAIL_ENABLED gate must also be on). Otherwise it logs exactly what it WOULD send.
//   GET/POST ?secret=<admin>        run now (shadow unless LIVE)
//   &dry=1                          force shadow (log only), even if LIVE
//   scheduled (Netlify cron)        self-authorizes via {next_run}
'use strict';
const { getSecret } = require('./_lib/secrets');
const meter = require('./_lib/usage-meter');
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const SITE = 'https://tnapplianceexchange.net';
exports.config = { timeout: 26 };
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

async function db() {
  const base = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { base, H: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } };
}
async function sget(base, H, path) { try { const r = await fetch(base + '/rest/v1/' + path, { headers: H, signal: AbortSignal.timeout(9000) }); return r.ok ? (await r.json().catch(() => [])) : []; } catch (_) { return []; } }

// Weekly (Mon–Sun) Ann usage — so the owner always knows where they stand against the
// 500-minute weekly bucket and can pause Ann if they want to hold at the included amount.
function composeWeekly(shop, ownerName, w) {
  var note = w.over
    ? "You've used all " + w.allowance_min + " included minutes this week — Ann keeps answering, overage is $0.40/min. Want to hold here? You can pause Ann anytime in your dashboard."
    : (w.near ? "Heads up — you're at " + w.pct + "% of this week's minutes. You can pause Ann in your dashboard if you'd like to stay within the included amount." : "You're at " + w.pct + "% of this week's minutes — plenty of room.");
  return 'Hi ' + (ownerName || shop) + ',\n\n'
    + "Ann's usage this week (" + w.week_label + ", resets Monday):\n\n"
    + '  📞 Minutes:  ' + w.minutes + ' of ' + w.allowance_min + ' included  (' + w.pct + '%)\n'
    + '  💬 Texts:    ' + w.texts + '\n\n'
    + note + '\n\n'
    + "We send this daily so you always know where you stand this week.\n\n— The Ant team";
}

async function sendEmail(to, subject, body) {
  const secret = await getSecret('EMAIL_SHARED_SECRET');
  const r = await fetch(SITE + '/.netlify/functions/send-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Auth': secret || '' },
    body: JSON.stringify({ to, subject, body }),
    signal: AbortSignal.timeout(12000),
  });
  return r.json().catch(() => ({ ok: false }));
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const guard = (await getSecret('ADMIN_SECRET')) || GUARD_FALLBACK;
  if (!scheduled && q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });

  const LIVE = String(await getSecret('PLATFORM_USAGE_DIGEST_LIVE') || '') === 'true';
  const dry = !!q.dry || !LIVE;
  const { base, H } = await db();
  if (!base) return json(200, { ok: false, error: 'no_platform_db' });

  const today = new Date().toISOString().slice(0, 10);
  const dayStart = today + 'T00:00:00Z';
  // Only tenants with a live Ann line have weekly phone usage. Read each shop's number +
  // assistant from settings.phone (the metering key). Sequential per tenant so parallel
  // Telnyx pulls can't 429 the account.
  const companies = await sget(base, H, 'company?select=id,name,status,settings&status=neq.test&order=name');
  const out = [];
  for (const c of companies) {
    const phone = (c.settings && c.settings.phone) || {};
    if (!phone.number || !phone.assistant_id) { out.push({ shop: c.name, skipped: 'no_phone' }); continue; }
    let w; try { w = meter.weeklyStatus(await meter.weeklyTelnyx(phone.number, phone.assistant_id)); } catch (_) { out.push({ shop: c.name, skipped: 'meter_err' }); continue; }
    if (w.minutes === 0 && w.texts === 0) { out.push({ shop: c.name, skipped: 'no_usage' }); continue; }
    const marker = await sget(base, H, `usage_event?company_id=eq.${c.id}&kind=eq.owner_digest&at=gte.${encodeURIComponent(dayStart)}&select=id&limit=1`);
    if (marker && marker[0]) { out.push({ shop: c.name, skipped: 'already_today' }); continue; }
    const owners = await sget(base, H, `app_user?company_id=eq.${c.id}&role=eq.owner&active=eq.true&select=email,name&limit=1`);
    const owner = owners && owners[0];
    if (!owner || !owner.email) { out.push({ shop: c.name, skipped: 'no_owner_email' }); continue; }
    const subject = c.name + ' — Ann usage this week (' + w.pct + '% of minutes)';
    const body = composeWeekly(c.name, owner.name, w);
    const row = { shop: c.name, to: owner.email, voice_min: w.minutes, texts: w.texts, pct: w.pct, week: w.week_label, mode: dry ? 'shadow' : 'live' };
    if (dry) { console.log('[usage-digest] WOULD email', owner.email, '—', w.minutes, '/', w.allowance_min, 'min (' + w.pct + '%),', w.texts, 'texts'); out.push(row); continue; }
    // LIVE: mark first (idempotent), then email (send-email still dry-runs unless EMAIL_ENABLED)
    try { await fetch(base + '/rest/v1/usage_event', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ company_id: c.id, kind: 'owner_digest', qty: 0, cost_cents: 0, source: 'digest', meta: { date: today } }), signal: AbortSignal.timeout(8000) }); } catch (_) {}
    const er = await sendEmail(owner.email, subject, body).catch(() => ({ ok: false }));
    row.email_result = er && (er.mode || (er.ok ? 'sent' : 'fail'));
    out.push(row);
  }
  return json(200, { ok: true, mode: dry ? 'shadow' : 'live', live_flag: LIVE, tenants: companies.length, results: out });
};
