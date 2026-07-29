// translate — shared EN→target-language translator for customer-facing text.
// Powers the "everything in their language" layer: the SMS chokepoint auto-
// translates every outbound customer text into the customer's stored language,
// and pages/tools can call this too. Uses Claude Haiku, preserves URLs, phone
// numbers, and $ amounts verbatim. FAIL-SAFE: any error / unknown lang returns
// the original English unchanged, so it can never break or garble a send.
'use strict';

// code -> human name for the model prompt. 'en' short-circuits (no call).
const LANG_NAME = { es: 'Spanish', vi: 'Vietnamese', ru: 'Russian', zh: 'Chinese', ar: 'Arabic', hi: 'Hindi', fr: 'French', en: 'English' };
// human name -> code, for translateToEnglish's detected-language mapping.
const NAME_TO_CODE = { spanish: 'es', vietnamese: 'vi', russian: 'ru', chinese: 'zh', 'chinese (simplified)': 'zh', mandarin: 'zh', arabic: 'ar', hindi: 'hi', french: 'fr', english: 'en' };

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

// INBOUND side of the bridge: a customer texts us in their own language; we detect
// it and translate the message INTO English so the office can read + act on it
// without speaking a word of the language. Returns { code, name, english }.
// FAIL-SAFE: any error / already-English returns the original text as `english`
// with code 'en', so it can never break the inbound recorder.
async function translateToEnglish(text) {
  const src = String(text || '');
  const out = { code: 'en', name: 'English', english: src };
  if (!src.trim()) return out;
  // Fast path: pure-ASCII text is treated as English and skips the API call (most
  // inbound is English; saves latency + tokens). ANY non-ASCII byte — Cyrillic,
  // Chinese, Arabic, Devanagari, or an accented Latin char — falls through to the
  // model, so es/vi/fr/ru/zh/ar/hi all get translated.
  if (/^[\x00-\x7F]*$/.test(src)) return out;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return out;
  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 7000);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        system: 'You process inbound text messages to an appliance-repair company. Detect the language the message is written in, then translate it into natural English so an English-speaking office worker can read it. If it is already English, return it unchanged. Preserve model numbers, part numbers, phone numbers, $ amounts, and URLs EXACTLY. Reply with ONLY compact JSON, no prose: {"language":"Spanish|Vietnamese|Russian|Chinese|Arabic|Hindi|French|English|...","english":"the message in English"}.',
        messages: [{ role: 'user', content: src.slice(0, 1200) }],
      }),
      signal: ctl.signal,
    });
    clearTimeout(tm);
    const d = await r.json();
    const raw = (d && d.content && d.content[0] && d.content[0].text) || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (parsed && parsed.english) {
      const nm = String(parsed.language || 'English').trim();
      const code = NAME_TO_CODE[nm.toLowerCase()] || 'en';
      return { code, name: nm, english: parsed.english };
    }
  } catch (_) {}
  return out;
}

module.exports = { translateTo, translateToEnglish, langName, LANG_NAME, NAME_TO_CODE };
