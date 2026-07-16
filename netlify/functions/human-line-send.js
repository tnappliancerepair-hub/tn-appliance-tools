// human-line-send — send a text FROM the shared human line (615-757-5500).
//
// The office (and techs) reply to customers on the HUMAN lane here, from a Telnyx
// number that is COMPLETELY separate from the AI line (588-9500). Sends straight
// through the Telnyx messages API (from = the human line) and logs the outbound as
// a customer_sms_reply (source:human_line) so it shows in the per-job thread on
// every surface. Opt-out is absolute. (Teddy 2026-07-14 — two-lane separation.)
//
//   POST { phone, message, job_id?, sender? }  ->  { ok, sent, provider_message_id }
'use strict';

const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const guard = require('./_lib/sms-guard');

const TELNYX = 'https://api.telnyx.com/v2';
// The human/office line customers get texted from. Switched 757-5500 → 857-8800 on
// 2026-07-16: 757-5500 was never A2P-10DLC-registered, so carriers silently dropped
// every office text ("none of my messages went through to them"). 857-8800 is on our
// APPROVED, active 10DLC campaign (alongside the AI line 588-9500), so it delivers.
// (857-8800 was the tech line; techs move to a different number via the Xano send_sms
// push — customers must be on an approved number, techs won't report spam.)
const HUMAN_LINE = '+16158578800';
const CORS = { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function e164(p) { let s = String(p || '').trim(); if (s.startsWith('+')) return '+' + s.slice(1).replace(/\D/g, ''); const d = s.replace(/\D/g, ''); if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; return d ? '+' + d : ''; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const to = e164(b.phone || b.to);
  const message = String(b.message || b.body || '').trim();
  if (!to || to.length < 12) return json(400, { ok: false, error: 'valid phone required' });
  if (!message) return json(400, { ok: false, error: 'message required' });

  // Opt-out is absolute — never text a STOP'd number, even on the human line.
  try { if (await guard.isOptedOut(to)) return json(200, { ok: false, sent: false, reason: 'opted_out' }); } catch (_) {}

  const KEY = await getSecret('TELNYX_API_KEY');
  if (!KEY) return json(200, { ok: false, error: 'TELNYX_API_KEY not available' });

  let sent = false, providerId = null, err = null;
  try {
    const r = await fetch(`${TELNYX}/messages`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: HUMAN_LINE, to, text: message }), signal: AbortSignal.timeout(15000),
    });
    const d = await r.json().catch(() => ({}));
    sent = r.ok; providerId = (d.data && d.data.id) || null; if (!r.ok) err = JSON.stringify(d.errors || d).slice(0, 220);
  } catch (e) { err = String((e && e.message) || e); }

  // Log to the shared per-job thread as an outbound HUMAN reply.
  if (sent) {
    try {
      await crud.logEvent('customer_sms_reply', {
        phone: to, to, from: HUMAN_LINE, body: message.slice(0, 400), message: message.slice(0, 400),
        source: 'human_line', lane: 'human', sender: String(b.sender || 'office'),
        job_id: Number(b.job_id || 0) || 0, at_ms: Date.now(),
      });
    } catch (_) {}
  }

  return json(200, { ok: sent, sent, provider_message_id: providerId, from: HUMAN_LINE, reason: err || undefined });
};
