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
      const q = event.queryStringParameters || {};
      // Office view: recent tech→office replies (the in-app tech messages).
      if (q.office_inbox) {
        const rows = await crud.searchPage(EVENT_LOG, { action: 'tech_reply_to_office' }, { created_at: 'desc' }, 60);
        const out = rows.map((r) => { let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } m = m || {}; return { id: r.id, technician_id: Number(m.technician_id) || 0, tech_name: m.tech_name || 'Tech', body: m.body || '', related_job_id: m.related_job_id || null, at_ms: m.at_ms || r.created_at || 0 }; });
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, messages: out }) };
      }
      // Office view: messages sent TO techs + read receipts (✓ Read / Unread).
      if (q.sent_to_techs) {
        const [sent, receipts] = await Promise.all([
          crud.searchPage(EVENT_LOG, { action: 'office_to_tech_message_sent' }, { created_at: 'desc' }, 80),
          crud.searchPage(EVENT_LOG, { action: 'tech_read_receipt' }, { created_at: 'desc' }, 300),
        ]);
        const readAt = {};
        for (const r of receipts) { let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } if (m && m.message_id != null && !readAt[m.message_id]) readAt[m.message_id] = m.at_ms || r.created_at || 0; }
        const mapped = sent.map((r) => { let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } m = m || {}; const mid = m.message_id; return { message_id: mid, tech_id: Number(m.tech_id) || 0, sender_name: m.sender_name || 'Office', body: m.body || m.body_preview || '', at_ms: m.at_ms || r.created_at || 0, read: !!readAt[mid], read_at: readAt[mid] || 0 }; });
        // Danielle's Messages was drowning in automated Ant->tech posts (nudges/
        // briefings) that are expected-unread and not hers to track. This read-
        // receipt view is only useful for messages a HUMAN at the office actually
        // sent (did the tech read MY message?) -- so drop the automation ("Ant..."
        // sender) and anything older than ~4 days. View-only filter: no data is
        // deleted, the techs' own inboxes are untouched.
        const CUT = Date.now() - 4 * 86400000;
        const out = mapped.filter((x) => !/^\s*ant\b/i.test(String(x.sender_name || '')) && (!(x.at_ms > 1e12) || x.at_ms >= CUT));
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, messages: out }) };
      }
      const techId = parseInt(q.technician_id, 10);
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

    // Read receipt — a tech opened an office/Ant message. Surfaced to the office
    // (?sent_to_techs) as ✓ Read / Unread so you can see who's reading.
    if (b.action === 'read_receipt') {
      await crud.logEvent('tech_read_receipt', { message_id: b.message_id, tech_id: parseInt(b.tech_id, 10) || 0, at_ms: Date.now() });
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
    }

    // Tech replies to the office from inside the app (in-app, NOT SMS). Lands in
    // event_log; the office Messages view reads action='tech_reply_to_office'.
    if (b.action === 'tech_reply') {
      const techId = parseInt(b.technician_id, 10) || 0;
      const body = String(b.body || '').trim();
      if (!techId || !body) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'technician_id + body required' }) };
      let techName = 'Tech';
      if (h) { try { const t = await crud.searchPage(TECH_TABLE, { id: techId }, null, 1); if (t && t[0] && t[0].first_name) techName = t[0].first_name; } catch (_) {} }
      await crud.logEvent('tech_reply_to_office', { technician_id: techId, tech_name: techName, body, related_job_id: b.related_job_id || null, at_ms: Date.now() });
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, technician_id: techId, tech_name: techName }) };
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
