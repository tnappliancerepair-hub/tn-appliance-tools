// tech-profile-outreach — Ant reaches out to the techs to (re)build their
// scheduling profile with the new conversational assistant. Office-password
// gated. Sends each tech a friendly SMS with their personal link to the Ant
// scheduler. Tone: Ant works for THEM, it doesn't dictate.
//
//   POST { office_password, tech_id? }   tech_id omitted = all active techs

'use strict';

const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const TELNYX_FROM = '+16158578800'; // tech-direction line
const TECH_TABLE = 15;
const ACTIVE = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 6: 'John' };

function msg(name, techId) {
  const link = `${SITE}/tech-schedule.html?tech_id=${techId}`;
  return `Hey ${name}, it's Ant 🐜 — the new + improved scheduling assistant for TN Appliance. `
    + `We set your profile up before, but I want to make sure I've got it exactly right so I can build your days the way YOU like to run. `
    + `Nobody's dictating your schedule — just tell me your hours, any regular days off, and what a great day looks like out there. `
    + `Takes 2 min, just talk to it like you would the office: ${link}`;
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

  const vr = await fetch(`${XANO}/verify_office_password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: String(b.office_password || '') }) });
  const vd = await vr.json().catch(() => ({}));
  if (!vd || !vd.success) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'wrong office password' }) };

  let rows = [];
  try { rows = await crud.searchPage(TECH_TABLE, {}, { id: 'asc' }, 50); } catch (_) {}
  const only = b.tech_id ? parseInt(b.tech_id, 10) : null;
  const targets = rows.filter((t) => ACTIVE[t.id] && (!only || t.id === only) && String(t.phone || '').replace(/\D/g, '').length >= 10);

  const results = [];
  for (const t of targets) {
    const r = await sendTelnyx(t.phone, msg(ACTIVE[t.id], t.id));
    results.push({ tech: ACTIVE[t.id], id: t.id, sent: r.ok, error: r.error || null });
  }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, sent_count: results.filter((r) => r.sent).length, results }) };
};
