// area-tech-notify — fresh routing strategy (Teddy 2026-07-09): EVERY Teddy Tool
// link goes to Teddy AND the tech for that job's zip. Teddy keeps final say —
// this is a heads-up to the area tech, NOT an assignment (Danielle still owns the
// board). Teddy "can confirm the tech if needed."
//
//   resolveAreaTech(zip)            -> { covered, tech_id, tech_name, phone, cluster }
//   sendAreaTechTeddyTool(resolved, { link, customer, appliance, city, jobId, kind })
//        -> { sent, tech_id, tech_name }   (skips id 1 = Teddy, and no-phone/UNROUTED)
'use strict';

const { sendSms } = require('./sms');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

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
  const msg = '🔧 New job in your area — ' + head + '. Job #' + (o.jobId || '?')
    + '. Teddy Tool (pre-diagnosis + video + parts): ' + o.link
    + '  — this is a heads-up; Teddy will confirm you if it\'s yours.';
  let sent = false;
  try { sent = !!(await sendSms(r.phone, msg, 'technician', (o.kind || 'area_tech') + '_teddy_tool')); } catch (_) {}
  return { sent, tech_id: r.tech_id, tech_name: r.tech_name };
}

module.exports = { resolveAreaTech, sendAreaTechTeddyTool, ID_PHONE };
