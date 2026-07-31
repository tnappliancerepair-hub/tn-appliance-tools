// listing-generator — "write once -> both surfaces." Takes ONE grounded source
// (curated component knowledge + the part identity) and emits matched content for
// BOTH ranking systems:
//   • amazon:  title, 5 bullets, description, A+ modules, backend search terms, fitment note
//   • website: an HTML /fix content block + HowTo/FAQ JSON-LD schema + meta title/desc
// Deterministic + template-based from the curated KB (NOT an LLM guess) so the copy
// is accurate + on-brand. Same moat content, two search engines.
//
//   POST { component | part_description, part_number?, brand?, appliance?, tier?, model_fits?[] }
'use strict';
const kb = require('./_lib/ant/component-knowledge');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function cap(s, n) { s = String(s || ''); return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…'; }
function titleCase(s) { return String(s || '').replace(/\b\w/g, (m) => m.toUpperCase()); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const SITE = 'https://tnapplianceexchange.net';

// Amazon US shopper languages worth doing ourselves = English + Spanish.
// Our website ranks in all 7 — so Website gets the full set.
const LANG_NAMES = { es: 'Spanish', ru: 'Russian', vi: 'Vietnamese', ar: 'Arabic', zh: 'Chinese (Simplified)', hi: 'Hindi', fr: 'French' };
const AMAZON_LANGS = ['es'];
const WEBSITE_LANGS = ['es', 'ru', 'vi', 'ar', 'zh', 'hi', 'fr'];

// Localize a flat {key:text} bundle into one language via a single Claude call.
// Preserves part/model numbers, brands, URLs, HTML tags, emojis, JSON structure.
// Fail-safe: returns null on any error so the caller keeps English for that language.
async function translateBundle(enFlat, langName) {
  const { getSecret } = require('./_lib/secrets');
  const key = process.env.ANTHROPIC_API_KEY || (await getSecret('ANTHROPIC_API_KEY').catch(() => ''));
  if (!key) return { __err: 'no_key' };
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 8000,
        system: `You localize e-commerce appliance-parts listing content into ${langName}. You receive a JSON object of English strings. Return a JSON object with the SAME keys, translating ONLY the human-readable text into natural, on-brand ${langName}. Preserve EXACTLY (never translate/alter): all part numbers, model numbers, brand names (Whirlpool, GE, Samsung, LG, Maytag, etc.), URLs, HTML tags and attributes, emojis, and "TN Appliance". Output ONLY the JSON object — no prose, no code fences.`,
        messages: [{ role: 'user', content: JSON.stringify(enFlat) }],
      }),
      signal: ctl.signal,
    });
    clearTimeout(tm);
    const d = await r.json();
    if (d && d.error) return { __err: 'api:' + (d.error.type || '') + ':' + String(d.error.message || '').slice(0, 80) };
    let raw = (d && d.content && d.content[0] && d.content[0].text) || '';
    raw = raw.replace(/```json|```/g, '').trim();
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');       // robust: slice to the JSON body
    if (a >= 0 && b > a) raw = raw.slice(a, b + 1);
    const out = JSON.parse(raw);
    return (out && typeof out === 'object') ? out : { __err: 'not_object' };
  } catch (e) { return { __err: 'exc:' + String((e && e.message) || e).slice(0, 80) }; }
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const q = b.component || b.part_description || b.symptom || '';
  const c = kb.match(q);
  if (!c) return json(200, { ok: false, found: false, note: 'No curated knowledge for that component — add it to component-knowledge.js first.' });
  const info = kb.withLinks(c);

  const compName = titleCase((c.names && c.names[0]) || 'Replacement Part');
  const appliance = titleCase(b.appliance || c.appliance || 'appliance');
  const brand = b.brand ? titleCase(b.brand) : '';
  const pn = String(b.part_number || '').trim();
  const tier = String(b.tier || 'oem').toLowerCase(); // oem | aftermarket | reman
  const tierLabel = tier === 'reman' ? 'Remanufactured' : (tier === 'aftermarket' ? 'Compatible' : 'OEM-Quality');
  const brandPhrase = brand ? (tier === 'oem' ? `${brand} ` : `for ${brand} `) : '';
  const fits = Array.isArray(b.model_fits) ? b.model_fits.filter(Boolean) : [];

  // ---------- AMAZON ----------
  const title = cap(`${brandPhrase}${compName}${pn ? ' ' + pn : ''} — ${appliance} Replacement (${tierLabel}) | Fits Your Model — Confirm Free | TN Appliance, Real Techs Since 2012`, 200);

  const sym2 = (info.symptoms || []).slice(0, 2).map((s) => s.replace(/\s*\(.*?\)\s*/g, ' ').trim());
  const test2 = (info.how_to_test || []).slice(0, 2).map((s) => s.replace(/^Unplug[^.]*\.\s*/i, '').trim());
  const bullets = [
    cap(`FIXES THESE SYMPTOMS: ${sym2.join(' ')}`, 490),
    cap(`NOT SURE IT'S THE PART? Here's the quick test — ${test2.join(' ')} Still unsure? Message our techs and we'll confirm it free.`, 490),
    cap(`CONFIRM IT FITS YOUR MACHINE: send us your model number and our techs verify fitment before you buy — no wrong-part returns.${fits.length ? ' Fits ' + fits.slice(0, 6).join(', ') + (fits.length > 6 ? ' + more' : '') + '.' : ''}`, 490),
    cap(`PICKED BY REAL APPLIANCE TECHS — TN Appliance has repaired these since 2012 (1,081 five-star reviews). We fix these every day, so we know the right part.`, 490),
    cap(`${tierLabel} part, honest help: scan the in-box QR for the fix guide or to talk to a real tech. Fast shipping, backed by people who actually repair appliances.`, 490),
  ];

  const description = cap([
    `${brandPhrase}${compName}${pn ? ' (Part ' + pn + ')' : ''} for your ${appliance.toLowerCase()}, from TN Appliance — a family repair company running since 2012.`,
    `Common signs this part has failed: ${(info.symptoms || []).join(' ')}`,
    `How to test it before you install: ${(info.how_to_test || []).join(' ')}`,
    info.safety ? `Safety: ${info.safety}` : '',
    `Not sure it's the right part for your model? That's the #1 cause of returns — so we do it differently: send your model number and our techs confirm fitment first. Scan the QR in the box for the step-by-step fix guide or to talk to a real appliance tech.`,
  ].filter(Boolean).join('\n\n'), 2000);

  const aplus = [
    { heading: `Is your ${compName.toLowerCase()} really the problem?`, body: `Signs it has failed:\n• ${(info.symptoms || []).join('\n• ')}` },
    { heading: 'How to test it (safely) before you install', body: `${(info.how_to_test || []).map((s, i) => (i + 1) + '. ' + s).join('\n')}${info.safety ? '\n\n⚠️ ' + info.safety : ''}` },
    { heading: 'Confirmed to fit — by real techs', body: `Wrong-part returns are the #1 headache with appliance parts. Send us your model number and our technicians verify this part fits your exact machine before you buy. We've repaired appliances since 2012 with 1,081 five-star reviews.` },
    { heading: 'Every part, every budget — one honest store', body: `We offer OEM, quality-aftermarket, and remanufactured options for the same part, each clearly labeled, so you pick your budget. Scan the QR in your box for the fix guide or to reach a real tech.` },
  ];

  // backend search terms (~250 bytes, deduped)
  const symWords = (info.symptoms || []).join(' ').toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const stop = new Set(['fridge', 'that', 'this', 'with', 'from', 'your', 'when', 'runs', 'while', 'often', 'only', 'have', 'they', 'them', 'like', 'into', 'over', 'part', 'clearly', 'unusual', 'builds', 'section', 'warms', 'warm']);
  const kws = [...new Set([...(c.names || []), appliance.toLowerCase(), brand.toLowerCase(), ...symWords].filter((w) => w && !stop.has(w)))];
  let backend = ''; for (const w of kws) { if ((backend + ' ' + w).length > 250) break; backend += (backend ? ' ' : '') + w; }

  // ---------- WEBSITE (/fix content block + schema) ----------
  const symLis = (info.symptoms || []).map((s) => `    <li>${esc(s)}</li>`).join('\n');
  const testLis = (info.how_to_test || []).map((s) => `    <li>${esc(s)}</li>`).join('\n');
  const linkAs = (info.links || []).map((l) => `  <a href="${esc(l.url)}">${esc(titleCase(l.label))} →</a>`).join('\n');
  const html_block = `<section class="part-help" id="${c.key}">
  <h2>${esc(compName)}${pn ? ' (' + esc(pn) + ')' : ''} — symptoms &amp; how to test</h2>
  <h3>Signs your ${esc(compName.toLowerCase())} has failed</h3>
  <ul>
${symLis}
  </ul>
  <h3>How to test it (safely)</h3>
  <ol>
${testLis}
  </ol>
${info.safety ? '  <p class="safety">🛟 ' + esc(info.safety) + '</p>\n' : ''}  <p>Repaired by TN Appliance techs since 2012. Not sure it's the right part? <a href="${SITE}/appliance-ai.html">Send us your model number</a> and we'll confirm it free.</p>
${linkAs}
</section>`;

  const faq = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: [
      { '@type': 'Question', name: `What are the signs of a bad ${compName.toLowerCase()}?`, acceptedAnswer: { '@type': 'Answer', text: (info.symptoms || []).join(' ') } },
      { '@type': 'Question', name: `How do I test a ${compName.toLowerCase()}?`, acceptedAnswer: { '@type': 'Answer', text: (info.how_to_test || []).join(' ') } },
    ],
  };
  const howto = {
    '@context': 'https://schema.org', '@type': 'HowTo', name: `How to test a ${compName.toLowerCase()}`,
    step: (info.how_to_test || []).map((s, i) => ({ '@type': 'HowToStep', position: i + 1, text: s })),
  };
  const meta_title = cap(`${compName} Symptoms & How to Test | ${appliance} | TN Appliance`, 60);
  const meta_description = cap(`Signs of a bad ${compName.toLowerCase()} and how to test it, from real appliance techs. ${(info.symptoms || [])[0] || ''}`, 155);

  const amazonEN = { title, bullets, description, aplus_modules: aplus, backend_search_terms: backend, fitment_note: fits.length ? `Fits: ${fits.join(', ')}` : 'Send model number to confirm fitment.' };
  const websiteEN = { html_block, faq_schema: faq, howto_schema: howto, meta_title, meta_description, suggested_fix_pages: info.links };

  const resp = { ok: true, found: true, component: c.key, appliance, brand, part_number: pn, tier, amazon: amazonEN, website: websiteEN };

  // ---------- MULTILINGUAL (opt-in) ----------
  // Amazon US = English + Spanish; website = all 7. One Claude call per language,
  // run in parallel; each falls back to English on failure.
  const wantML = b.translate === true || (Array.isArray(b.languages) && b.languages.length);
  if (wantML && process.env.ANTHROPIC_API_KEY) {
    const langs = Array.isArray(b.languages) && b.languages.length ? b.languages : WEBSITE_LANGS;
    // flatten every translatable string into one keyed bundle
    const flat = { title, description, fitment_note: amazonEN.fitment_note, backend, meta_title, meta_description, html_block };
    bullets.forEach((x, i) => (flat['b' + i] = x));
    aplus.forEach((m, i) => { flat['m' + i + 'h'] = m.heading; flat['m' + i + 'b'] = m.body; });
    (faq.mainEntity || []).forEach((qa, i) => { flat['fq' + i] = qa.name; flat['fa' + i] = qa.acceptedAnswer.text; });
    (howto.step || []).forEach((s, i) => (flat['ht' + i] = s.text));

    const done = await Promise.all(langs.map(async (lc) => {
      const t = await translateBundle(flat, LANG_NAMES[lc] || lc);
      return { lc, t };
    }));

    const azOut = {}, webOut = {}, dbg = {};
    for (const { lc, t } of done) {
      if (!t || t.__err) { dbg[lc] = (t && t.__err) || 'null'; continue; }
      const g = (k) => (t[k] != null ? t[k] : flat[k]);
      const bl = bullets.map((_, i) => g('b' + i));
      const mods = aplus.map((_, i) => ({ heading: g('m' + i + 'h'), body: g('m' + i + 'b') }));
      if (AMAZON_LANGS.includes(lc)) {
        azOut[lc] = { title: g('title'), bullets: bl, description: g('description'), aplus_modules: mods, backend_search_terms: g('backend'), fitment_note: g('fitment_note') };
      }
      const rtl = lc === 'ar';
      const faqT = { '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: lc, mainEntity: (faq.mainEntity || []).map((qa, i) => ({ '@type': 'Question', name: g('fq' + i), acceptedAnswer: { '@type': 'Answer', text: g('fa' + i) } })) };
      const howtoT = { '@context': 'https://schema.org', '@type': 'HowTo', inLanguage: lc, name: g('ht0') ? undefined : howto.name, step: (howto.step || []).map((s, i) => ({ '@type': 'HowToStep', position: i + 1, text: g('ht' + i) })) };
      webOut[lc] = { html_block: rtl ? g('html_block').replace('<section ', '<section dir="rtl" ') : g('html_block'), meta_title: g('meta_title'), meta_description: g('meta_description'), faq_schema: faqT, howto_schema: howtoT, suggested_fix_pages: info.links };
    }
    resp.translations = { amazon: azOut, website: webOut, note: 'Amazon = EN + ES (US Spanish shoppers). Website = all requested languages.' };
    if (Object.keys(dbg).length) resp.translations._debug = dbg;
  }

  return json(200, resp);
};
