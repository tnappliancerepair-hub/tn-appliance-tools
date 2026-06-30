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

  let sent = false;
  try { sent = !!(await sendSms(phone, translated, 'customer', 'translated_reply')); } catch (_) { sent = false; }

  // Record the reply as a `customer_sms_reply` (the action the office Messages
  // page + list_sms_conversations already recognize as an OUTBOUND reply) so the
  // thread flips out of "waiting" and the red REPLY badge clears. It was being
  // logged as `translated_reply_sent`, which NEITHER surface counts — so Danielle
  // replied and the threads kept showing as unanswered (2026-06-30). Carry `body`
  // for the snippet + the translation detail for the record.
  try {
    const tok = process.env.XANO_METADATA_TOKEN;
    if (tok) await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'customer_sms_reply', metadata: { phone, body: translated.slice(0, 400), message: translated.slice(0, 400), language, english: replyEnglish.slice(0, 400), translated: translated.slice(0, 400), sent, source: 'office_translated_reply', at_ms: Date.now() } }),
    });
  } catch (_) {}

  return json(200, { ok: sent, sent, language, translated });
};
