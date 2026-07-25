// translate — shared EN→target-language translator for customer-facing text.
// Powers the "everything in their language" layer: the SMS chokepoint auto-
// translates every outbound customer text into the customer's stored language,
// and pages/tools can call this too. Uses Claude Haiku, preserves URLs, phone
// numbers, and $ amounts verbatim. FAIL-SAFE: any error / unknown lang returns
// the original English unchanged, so it can never break or garble a send.
'use strict';

// code -> human name for the model prompt. 'en' short-circuits (no call).
const LANG_NAME = { es: 'Spanish', vi: 'Vietnamese', ar: 'Arabic', hi: 'Hindi', fr: 'French', en: 'English' };

function langName(code) {
  const c = String(code || '').trim().toLowerCase();
  if (LANG_NAME[c]) return LANG_NAME[c];
  // accept a full name too ("spanish")
  const byName = Object.values(LANG_NAME).find((n) => n.toLowerCase() === c);
  return byName || '';
}

// Translate English `text` into the target language. Returns the translated
// string, or the original on any failure / if target is English/unknown.
async function translateTo(text, targetLangCodeOrName) {
  const src = String(text || '');
  if (!src.trim()) return src;
  const name = langName(targetLangCodeOrName);
  if (!name || name === 'English') return src;             // no-op for English/unknown
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return src;
  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 7000);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        system: 'You translate customer text messages for an appliance-repair company into ' + name + '. Translate naturally and warmly, like a real person texting. Keep it concise. CRITICAL: copy every URL/link, phone number, $ amount, and the word TN Appliance / TN Appliance Exchange EXACTLY as written — never translate, alter, or drop a link or a number. Preserve emojis. Output ONLY the translated message, no quotes, no notes, no preamble.',
        messages: [{ role: 'user', content: src.slice(0, 1200) }],
      }),
      signal: ctl.signal,
    });
    clearTimeout(tm);
    const d = await r.json();
    const out = (d && d.content && d.content[0] && d.content[0].text || '').trim();
    return out || src;
  } catch (_) { return src; }
}

module.exports = { translateTo, langName, LANG_NAME };
