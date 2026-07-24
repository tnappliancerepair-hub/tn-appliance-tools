// area-tech-notify — fresh routing strategy (Teddy 2026-07-09): EVERY Teddy Tool
// link goes to Teddy AND the tech for that job's zip. Teddy keeps final say —
// this is a heads-up to the area tech, NOT an assignment (Danielle still owns the
// board). Teddy "can confirm the tech if needed."
//
//   resolveAreaTech(zip)            -> { covered, tech_id, tech_name, phone, cluster }
//   sendAreaTechTeddyTool(resolved, { link, customer, appliance, city, jobId, kind })
//        -> { sent, tech_id, tech_name }   (skips id 1 = Teddy, and no-phone/UNROUTED)
'use strict';

const { getSecret } = require('./secrets');
const crud = require('./xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const TELNYX = 'https://api.telnyx.com/v2';

// 🥊 Beat the Boss — the game link each side gets. Tech locks their diagnosis
// before Teddy; the game screen also links straight to the full Teddy Tool.
function gameLink(jobId, who, techId) {
  return `${SITE}/beat-the-boss.html?job_id=${jobId}&who=${who === 'teddy' ? 'teddy' : 'tech'}`
    + (who !== 'teddy' && techId ? `&tech_id=${techId}` : '');
}
// The note appended to Teddy's siren: who it routed to + his own "lock your pick" link.
function bossSirenNote(jobId, areaTech) {
  const nm = (areaTech && areaTech.tech_name) || 'UNROUTED — assign one';
  return '  · area tech: ' + nm + '  · 🥊 beat them, lock your pick: ' + gameLink(jobId, 'teddy', 0);
}

// Tech id -> cell (roster). Andre = the 504 on his tech row; Billy (5) left.
const ID_PHONE = {
  1: '+16154855795', // Teddy (owner — already gets the siren, never texted here)
  2: '+16159671304', // Jimmy
  3: '+15049099413', // Andre
  4: '+16158291654', // Lee
  6: '+18133527686', // John
};

async function resolveAreaTech(zip) {
  const z = String(zip || '').replace(/\D/g, '').slice(0, 5);
  if (z.length < 5) return { covered: false, tech_id: 0, tech_name: '', phone: '', cluster: '' };
  try {
    const r = await fetch(`${XANO}/check_service_zone?zip_code=${z}`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json();
    const id = Number(d && d.suggested_technician_id) || 0;
    return {
      covered: !!(d && d.covered),
      tech_id: id,
      tech_name: (d && d.suggested_tech_name) || '',
      phone: ID_PHONE[id] || '',
      cluster: (d && d.cluster) || '',
    };
  } catch (_) {
    return { covered: false, tech_id: 0, tech_name: '', phone: '', cluster: '' };
  }
}

async function sendAreaTechTeddyTool(resolved, opts) {
  const o = opts || {};
  const r = resolved || {};
  // Teddy (id 1) already gets the owner siren; skip him and any zip with no tech.
  if (!r.phone || r.tech_id === 1) {
    return { sent: false, tech_id: r.tech_id || 0, tech_name: r.tech_name || '' };
  }
  const head = [o.customer || '', o.appliance || '', o.city || ''].filter(Boolean).join(' · ');
  const game = gameLink(o.jobId, 'tech', r.tech_id);
  const msg = '🔧 New job in your area — ' + head + ' (#' + (o.jobId || '?') + ').'
    + ' Call them for a video before you roll — a good one can save the trip.'
    + ' 🥊 Beat the Boss: lock your diagnosis first → ' + game + ' (video + parts inside).';
  // Send from the APPROVED line via Telnyx directly — NOT the old sendSms('technician')
  // path, which routes to the dead TELNYX_FROM_TECH (757-5500) and gets carrier-dropped.
  // This is the ONE tech text that must land (Teddy 2026-07-24): intake done -> the area
  // tech instantly. Everything else stays on the dropped path (no tech spam).
  const FROM = (await getSecret('TECH_PREP_FROM')) || '+16158578800';
  let sent = false, providerId = null;
  try {
    const KEY = await getSecret('TELNYX_API_KEY');
    if (KEY) {
      const resp = await fetch(`${TELNYX}/messages`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: r.phone, text: msg }), signal: AbortSignal.timeout(15000),
      });
      const d = await resp.json().catch(() => ({}));
      sent = resp.ok; providerId = (d.data && d.data.id) || null;
    }
  } catch (_) {}
  // Dedup marker so the tech-prep-link sweep (the assigned-later backstop) never double-texts this job.
  if (sent) { try { await crud.logEvent('tech_prep_link_sent', { job_id: Number(o.jobId) || 0, technician_id: r.tech_id, to: r.phone, provider_id: providerId, source: 'intake_area_tech', at_ms: Date.now() }); } catch (_) {} }
  return { sent, tech_id: r.tech_id, tech_name: r.tech_name };
}

module.exports = { resolveAreaTech, sendAreaTechTeddyTool, gameLink, bossSirenNote, ID_PHONE };
