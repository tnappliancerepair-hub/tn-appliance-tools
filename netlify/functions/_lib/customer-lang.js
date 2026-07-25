// customer-lang — remembers a customer's preferred language by phone, so every
// outbound text (and any lookup) can serve them in it. Backed by event_log
// 'customer_language' markers (newest wins). Set it when we learn a language:
// a Spanish intake, a Spanish-line call, or a non-English inbound text.
'use strict';

const crud = require('./xano/metadata-crud');

function toE164(p) {
  let s = String(p || '').trim();
  if (s.startsWith('+')) return '+' + s.slice(1).replace(/\D/g, '');
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return d ? '+' + d : '';
}
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

const OK = new Set(['es', 'vi', 'ar', 'hi', 'fr', 'en']);
function norm(code) {
  const c = String(code || '').trim().toLowerCase();
  if (OK.has(c)) return c;
  const byName = { spanish: 'es', vietnamese: 'vi', arabic: 'ar', hindi: 'hi', french: 'fr', english: 'en' }[c];
  return byName || '';
}

// Record a customer's language (no-op for blank/unknown). Skips 'en' write only
// if you pass skipEnglish — usually harmless to record 'en' too.
async function setCustomerLang(phone, code) {
  const to = toE164(phone); const lang = norm(code);
  if (!to || !lang) return false;
  try { await crud.logEvent('customer_language', { phone: to, lang, at_ms: Date.now() }); return true; } catch (_) { return false; }
}

// Resolve the newest known language for a phone. Returns a code ('es'...) or 'en'.
async function getCustomerLang(phone) {
  const to = toE164(phone); if (!to) return 'en';
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'customer_language' }, { id: 'desc' }, 400);
    const hit = (rows || []).find((r) => toE164(metaOf(r).phone) === to);
    return (hit && norm(metaOf(hit).lang)) || 'en';
  } catch (_) { return 'en'; }
}

module.exports = { setCustomerLang, getCustomerLang, toE164, norm };
