// vent-plan-reminder — the recurring engine behind the Vent Care Plan. Once a year,
// ~11 months after a member joined (or after their last reminder), it texts THE OWNER a
// digest of members due for their annual dryer vent cleaning so a real person reaches out
// and books it. Owner-alert only — never a proactive customer text (honors the standing
// "don't text customers unless texted first" rule); the human makes the outreach.
//
//   scheduled (netlify.toml) · manual: ?secret=VAPI_ADMIN_SECRET[&dryrun=1][&days=335]
'use strict';
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');
const OWNER = '+16154855795';
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled) {
    const guard = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (q.secret !== guard) return j(403, { ok: false, error: 'forbidden' });
  }
  const dry = q.dryrun === '1';
  const dueDays = Math.max(60, parseInt(q.days || '335', 10) || 335);   // ~11 months
  const now = Date.now();
  const cutoff = now - dueDays * 86400000;

  // Pull plan members (signup rows). Newest first; scan a healthy window.
  let members = [];
  try { members = await crud.searchPage(crud.TABLES.event_log, { action: 'vent_plan_signup' }, { id: 'desc' }, 500); } catch (_) { return j(200, { ok: false, error: 'scan failed' }); }

  // Keep the most-recent signup per phone (a member is one person).
  const byPhone = new Map();
  for (const r of members) {
    const m = (r && r.metadata) || {};
    const ph = digits(m.phone); if (!ph) continue;
    if (!byPhone.has(ph)) byPhone.set(ph, { ph, name: m.name || '', city: m.city || '', at: Number(m.at_ms || 0), plan: m.plan_type || 'home' });
  }

  const nowYear = new Date(now).getUTCFullYear();
  const due = [];
  for (const mem of byPhone.values()) {
    if (!mem.at || mem.at > cutoff) continue;    // joined less than ~11 months ago
    // Dedup: one reminder per member per calendar year.
    let already = false;
    try { already = !!(await crud.searchOne(crud.TABLES.event_log, { action: 'vent_plan_reminded_' + mem.ph + '_' + nowYear }, { id: 'desc' })); } catch (_) {}
    if (already) continue;
    due.push(mem);
  }

  if (due.length && !dry) {
    const lines = due.slice(0, 12).map((m) => `• ${m.name || '(member)'} ${m.ph}${m.city ? ' · ' + m.city : ''}${/propert|multi|apart/i.test(m.plan) ? ' · PROPERTY' : ''}`).join('\n');
    const body = `[ant] 🔁 Vent Care Plan — ${due.length} member(s) due for their annual dryer vent cleaning. Reach out + book:\n${lines}`;
    try { await sendSms(OWNER, body, 'owner', 'vent_plan_reminder'); } catch (_) {}
    for (const m of due) { try { await crud.logEvent('vent_plan_reminded_' + m.ph + '_' + nowYear, { name: m.name, city: m.city, at_ms: now }); } catch (_) {} }
  }

  return j(200, { ok: true, dry, members: byPhone.size, due: due.length, due_sample: due.slice(0, 12).map((m) => ({ name: m.name, phone: m.ph, city: m.city })) });
};
