// send-translated-reply — outbound side of the translation bridge. The office
// types a reply in ENGLISH; we detect the customer's language (from their last
// message) and send the reply IN THEIR LANGUAGE. So the office converses with any
// customer without speaking a word of their language.
//
//   POST { phone, reply_english, customer_text? }  ->  { ok, sent, language, translated }
'use strict';

const { sendSms } = require('./_lib/sms');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }

// Detect the customer's language from their last message + translate the reply
// into it. Returns { language, translated }. Falls back to English passthrough.
async function translateReply(replyEnglish, customerText) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !customerText) return { language: 'English', translated: replyEnglish };
  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 7000);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: 'You translate replies for an appliance-repair business. You are given (1) the customer\'s last message, in their own language, and (2) a reply written in English. Detect the customer\'s language from their message, then translate the English reply naturally INTO that language. If the customer\'s language is English, return the reply unchanged. Reply with ONLY compact JSON, no prose: {"language":"Spanish|Vietnamese|Arabic|Hindi|English|...","translated":"the reply in the customer\'s language"}.',
        messages: [{ role: 'user', content: 'CUSTOMER MESSAGE:\n' + String(customerText).slice(0, 800) + '\n\nENGLISH REPLY TO TRANSLATE:\n' + String(replyEnglish).slice(0, 800) }],
      }),
      signal: ctl.signal,
    });
    clearTimeout(tm);
    const d = await r.json();
    const raw = (d && d.content && d.content[0] && d.content[0].text) || '';
    const out = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (out && out.translated) return { language: out.language || 'their language', translated: out.translated };
  } catch (_) {}
  return { language: 'English', translated: replyEnglish };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const phone = String(b.phone || '').trim();
  const replyEnglish = String(b.reply_english || b.message || '').trim();
  const customerText = String(b.customer_text || '').trim();
  if (phone.replace(/\D/g, '').length < 10) return json(400, { ok: false, error: 'valid phone required' });
  if (!replyEnglish) return json(400, { ok: false, error: 'reply text required' });

  const { language, translated } = await translateReply(replyEnglish, customerText);

  // Send FROM the shared HUMAN line (757-5500), NOT the AI line — office replies
  // live on the human lane now (Teddy 2026-07-15, two-lane separation). human-line-send
  // does the Telnyx send from 757-5500 + logs customer_sms_reply (lane:human) into the
  // shared per-job thread, so office tile + tech page + portal all show it.
  const SITE = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://tnapplianceexchange.net';
  let sent = false;
  try {
    const r = await fetch(`${SITE}/.netlify/functions/human-line-send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message: translated, sender: String(b.sender || 'office'), job_id: Number(b.job_id || 0) || 0 }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json().catch(() => ({}));
    sent = !!(d && d.sent);
  } catch (_) { sent = false; }

  return json(200, { ok: sent, sent, language, translated });
};
