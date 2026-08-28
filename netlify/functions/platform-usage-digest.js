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
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

async function db() {
  const base = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { base, H: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } };
}
async function sget(base, H, path) { try { const r = await fetch(base + '/rest/v1/' + path, { headers: H, signal: AbortSignal.timeout(9000) }); return r.ok ? (await r.json().catch(() => [])) : []; } catch (_) { return []; } }

function composeBody(shop, ownerName, d) {
  var near = (d.voice_pct >= 80 || d.sms_pct >= 80) && !(d.over_voice || d.over_sms);
  var over = d.over_voice > 0 || d.over_sms > 0;
  var note = over
    ? "You've passed your monthly included amount — no action needed, we keep you running. If this is a regular month, we can right-size your plan so it fits."
    : (near ? "Heads up: you're getting close to your monthly included amount." : "You're comfortably within your plan — nothing to do.");
  return 'Hi ' + (ownerName || shop) + ',\n\n'
    + "Here's your Ant usage so far this month (" + d.period + "):\n\n"
    + '  📞 Call minutes:  ' + d.voice_min + ' of ' + d.included_voice_min + ' included\n'
    + '  💬 Texts:         ' + d.sms_out + ' of ' + d.included_sms + ' included\n\n'
    + note + '\n\n'
    + "We send this once a day so you always know where you stand.\n\n— The Ant team";
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
  const companies = await sget(base, H, 'company?select=id,name,status&status=neq.test&order=name');
  const out = [];
  for (const c of companies) {
    let d; try { d = await meter.ownerDigest(c.id); } catch (_) { continue; }
    if (!d.has_usage) { out.push({ shop: c.name, skipped: 'no_usage' }); continue; }
    // dedupe: already digested today?
    const marker = await sget(base, H, `usage_event?company_id=eq.${c.id}&kind=eq.owner_digest&at=gte.${encodeURIComponent(dayStart)}&select=id&limit=1`);
    if (marker && marker[0]) { out.push({ shop: c.name, skipped: 'already_today' }); continue; }
    const owners = await sget(base, H, `app_user?company_id=eq.${c.id}&role=eq.owner&active=eq.true&select=email,name&limit=1`);
    const owner = owners && owners[0];
    if (!owner || !owner.email) { out.push({ shop: c.name, skipped: 'no_owner_email' }); continue; }
    const subject = c.name + ' — your Ant usage this month';
    const body = composeBody(c.name, owner.name, d);
    const row = { shop: c.name, to: owner.email, voice_min: d.voice_min, sms: d.sms_out, mode: dry ? 'shadow' : 'live' };
    if (dry) { console.log('[usage-digest] WOULD email', owner.email, '—', d.voice_min, 'min /', d.sms_out, 'texts'); out.push(row); continue; }
    // LIVE: mark first (idempotent), then email (send-email still dry-runs unless EMAIL_ENABLED)
    try { await fetch(base + '/rest/v1/usage_event', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ company_id: c.id, kind: 'owner_digest', qty: 0, cost_cents: 0, source: 'digest', meta: { date: today } }), signal: AbortSignal.timeout(8000) }); } catch (_) {}
    const er = await sendEmail(owner.email, subject, body).catch(() => ({ ok: false }));
    row.email_result = er && (er.mode || (er.ok ? 'sent' : 'fail'));
    out.push(row);
  }
  return json(200, { ok: true, mode: dry ? 'shadow' : 'live', live_flag: LIVE, tenants: companies.length, results: out });
};
