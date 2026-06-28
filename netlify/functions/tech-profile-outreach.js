// tech-profile-outreach — Ant reaches out to the techs to (re)build their
// scheduling profile with the new conversational assistant. Office-password
// gated. Sends each tech a friendly SMS with their personal link to the Ant
// scheduler. Tone: Ant works for THEM, it doesn't dictate.
//
//   POST { office_password, tech_id? }   tech_id omitted = all active techs

'use strict';

const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const TELNYX_FROM = '+16158578800'; // tech-direction line
const TECH_TABLE = 15;
const ACTIVE = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 6: 'John' };

function msg(name, techId) {
  const link = `${SITE}/tech-schedule.html?tech_id=${techId}`;
  return `Hey ${name}, it's Ant 🐜 from TN Appliance — happy to help, and my whole job is to make your days easier. `
    + `Teddy's setting me up to build your schedule around YOUR life: your hours, any regular days off (and why), the areas you want, where you like your last stop, and what a great day looks like. `
    + `Take 2 min to tell me and I'll honor all of it. Want more work? I'll fill your day. Running behind? I'll text your customers and help. `
    + `You stay focused on getting the jobs done great — I'll handle the rest. And anytime you want more work or need a day off, just reply right here and I've got it. Teddy's got your back and wants you to win. Talk to me here: ${link}`;
}

async function sendTelnyx(to, text) {
  const key = process.env.TELNYX_API_KEY;
  if (!key) return { ok: false, error: 'no TELNYX_API_KEY' };
  try {
    const r = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: TELNYX_FROM, to, text }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, id: (j.data && j.data.id) || null, error: r.ok ? null : (JSON.stringify(j).slice(0, 160)) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { b = {}; }

  // Auth: admin secret OR office password.
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let authed = b.secret && b.secret === admin;
  if (!authed) {
    const vr = await fetch(`${XANO}/verify_office_password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: String(b.office_password || '') }) });
    const vd = await vr.json().catch(() => ({}));
    authed = !!(vd && vd.success);
  }
  if (!authed) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized (need secret or office_password)' }) };

  let rows = [];
  try { rows = await crud.searchPage(TECH_TABLE, {}, { id: 'asc' }, 50); } catch (_) {}
  const only = b.tech_id ? parseInt(b.tech_id, 10) : null;
  const includeOwner = b.include_owner === true;
  // dry_run = compute the recipient list + message, send nothing.
  const targets = rows.filter((t) => ACTIVE[t.id] && (!only || t.id === only) && (includeOwner || t.id !== 1) && String(t.phone || '').replace(/\D/g, '').length >= 10);
  if (b.dry_run) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, dry_run: true, would_send: targets.map((t) => ({ tech: ACTIVE[t.id], id: t.id, phone_last4: String(t.phone).replace(/\D/g, '').slice(-4) })), sample_message: targets[0] ? msg(ACTIVE[targets[0].id], targets[0].id) : null }) };
  }

  const results = [];
  for (const t of targets) {
    const r = await sendTelnyx(t.phone, msg(ACTIVE[t.id], t.id));
    results.push({ tech: ACTIVE[t.id], id: t.id, sent: r.ok, error: r.error || null });
  }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, sent_count: results.filter((r) => r.sent).length, results }) };
};
