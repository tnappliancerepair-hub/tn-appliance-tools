// tech-message — "drop your tech a message." A caller wants to reach their
// technician; instead of interrupting him, Ant takes a message FOR the tech.
// The tech gets an SMS alert + a flashing alert on his app, taps it, reads it.
//
//   POST { job_id?, technician_id?, customer_name?, phone?, message }  -> create + alert tech
//   GET  ?technician_id=X                                              -> unread messages
//   POST { action:'read', message_id }                                 -> mark read

'use strict';

const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const SITE = 'https://tnapplianceexchange.net';
const JOBS_TABLE = 7, TECH_TABLE = 15, EVENT_LOG = 3;

function mh() { const t = process.env.XANO_METADATA_TOKEN; return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null; }

exports.handler = async function (event) {
  try {
    const h = mh();
    if (event.httpMethod === 'GET') {
      const techId = parseInt((event.queryStringParameters || {}).technician_id, 10);
      if (!techId) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'technician_id required' }) };
      const [msgs, reads] = await Promise.all([
        crud.searchPage(EVENT_LOG, { action: 'tech_message' }, { created_at: 'desc' }, 200),
        crud.searchPage(EVENT_LOG, { action: 'tech_message_read' }, { created_at: 'desc' }, 200),
      ]);
      const readIds = new Set();
      for (const r of reads) { let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } if (m && m.message_id != null) readIds.add(String(m.message_id)); }
      const out = [];
      for (const r of msgs) {
        let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } m = m || {};
        if (Number(m.technician_id) !== techId) continue;
        if (readIds.has(String(r.id))) continue;
        out.push({ id: r.id, customer_name: m.customer_name || '', phone: m.phone || '', message: m.message || '', job_id: m.job_id || null, at_ms: m.at_ms || r.created_at || 0 });
      }
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, unread: out.length, messages: out }) };
    }

    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    const b = JSON.parse(event.body || '{}');

    if (b.action === 'read') {
      await crud.logEvent('tech_message_read', { message_id: b.message_id, at_ms: Date.now() });
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, read: b.message_id }) };
    }

    const message = String(b.message || '').trim();
    if (!message) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'message required' }) };
    // resolve the tech (from technician_id or via the job)
    let techId = parseInt(b.technician_id, 10) || 0;
    if (!techId && b.job_id && h) {
      try { const j = await (await fetch(`${META}/table/${JOBS_TABLE}/content/${parseInt(b.job_id, 10)}`, { headers: h })).json(); techId = parseInt(j && j.technician_id, 10) || 0; } catch (_) {}
    }
    if (!techId) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no_tech', note: 'job has no assigned tech yet — take an office message instead' }) };

    await crud.logEvent('tech_message', { technician_id: techId, job_id: b.job_id || null, customer_name: b.customer_name || '', phone: b.phone || '', message, at_ms: Date.now() });

    // SMS the tech an alert
    let techName = 'there', sent = false;
    if (h) {
      try {
        const t = await crud.searchPage(TECH_TABLE, { id: techId }, null, 1);
        const tech = t && t[0];
        techName = (tech && tech.first_name) || 'there';
        if (tech && tech.phone) {
          const who = b.customer_name || 'A customer';
          const sms = '📩 ' + who + ' left you a message: "' + message.slice(0, 160) + '"' + (b.phone ? (' (' + b.phone + ')') : '') + ' — open your app: ' + SITE + '/tech-daily-dashboard.html?tech_id=' + techId;
          await sendSms(tech.phone, sms, 'technician', 'tech_message').catch(() => {});
          sent = true;
        }
      } catch (_) {}
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, technician_id: techId, tech_name: techName, alerted: sent }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
