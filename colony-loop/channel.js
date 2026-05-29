// Channel-aware SMS composer.
//
// Customer-direction agents call this instead of hand-rolling the body
// each time. Picks the right tone based on how the customer has
// engaged with us in the last 60 days:
//
//   PORTAL: short SMS with portal link. Full info / action lives in
//           the portal because they actually use it.
//   SMS:    full info + actionable detail INLINE in the SMS body
//           because they won't tap a portal link.
//   UNKNOWN: short SMS + portal link AND inline key info (safe default
//           that works for both).
//
// Each agent supplies the parts it needs (intro, inline detail block,
// portal URL, action label) and this layer assembles them according
// to the customer's preference.

import { getCustomerChannelPreference, getCustomerCommsStyleSamples } from './xano.js';

const MAX_SMS_CHARS = 320; // single-message ceiling we aim for

export async function composeForChannel({
  customerId,
  intro,           // short headline — e.g. "your parts arrived"
  inlineDetail,    // full info if we have to put it in the SMS — multi-line OK
  portalUrl,       // tnapplianceexchange.net/customer-portal.html?... if applicable
  portalActionLabel, // e.g. "pick a return-visit time"
  fallback,        // optional fallback body if everything else collapses
} = {}) {
  const [pref, style] = await Promise.all([
    getCustomerChannelPreference(customerId).catch(() => ({ prefers: 'unknown' })),
    classifyCommsStyle(customerId).catch(() => ({ style: 'unknown' })),
  ]);
  const prefers = (pref && pref.prefers) || 'unknown';
  const styleName = (style && style.style) || 'unknown';

  // Tone-shape the headline + inline body per style. Same intro text
  // gets transformed: brief = single line; conversational = friendly
  // multi-line; formal = polite + full punctuation. UNKNOWN = current
  // default (terse-warm balance).
  const shaped = shapeForStyle({ intro, inlineDetail, portalActionLabel }, styleName);

  let body;
  if (prefers === 'portal' && portalUrl) {
    body = shaped.portalActionLabel
      ? `[TN Appliance] ${shaped.intro}. ${cap(shaped.portalActionLabel)}: ${portalUrl}`
      : `[TN Appliance] ${shaped.intro}. Details: ${portalUrl}`;
  } else if (prefers === 'sms') {
    const inline = (shaped.inlineDetail || '').trim();
    body = `[TN Appliance] ${shaped.intro}.${inline ? '\n\n' + inline : ''}`;
  } else {
    const inline = (shaped.inlineDetail || '').trim();
    const head = portalUrl
      ? `[TN Appliance] ${shaped.intro}.${shaped.portalActionLabel ? ' ' + cap(shaped.portalActionLabel) + ': ' + portalUrl : ' ' + portalUrl}`
      : `[TN Appliance] ${shaped.intro}.`;
    if (inline && (head.length + inline.length + 2) <= MAX_SMS_CHARS) {
      body = head + '\n\n' + inline;
    } else {
      body = head;
    }
  }

  if (!body || body.trim() === '') body = fallback || '[TN Appliance] Update on your appointment — call 615-280-2949.';

  return {
    body,
    prefers,
    style: styleName,
    evidence: (pref && pref.evidence) || {},
  };
}

// Inbound-SMS style classifier. Pulls the last 60d of inbound messages
// from this customer and decides:
//   brief         — short bare confirmations ("ok", "yes", "thx") OR avg < 25 chars
//   formal        — politeness words (thank you / sir / ma'am / please) ≥ 30%
//   conversational — default if neither triggers and we have ≥3 samples
//   unknown       — < 3 samples; brain stays adaptive
async function classifyCommsStyle(customerId) {
  if (!customerId) return { style: 'unknown', sample_count: 0 };
  const samples = await getCustomerCommsStyleSamples(customerId).catch(() => []);
  if (!samples || samples.length < 3) return { style: 'unknown', sample_count: (samples || []).length };

  let totalChars = 0;
  let briefHits = 0;
  let formalHits = 0;
  let n = 0;

  for (const s of samples) {
    let meta = s.metadata;
    if (typeof meta === 'string') {
      try { meta = JSON.parse(meta); } catch (_) { meta = {}; }
    }
    const body = String((meta && meta.body_preview) || '').trim();
    if (!body) continue;
    n += 1;
    totalChars += body.length;
    const lower = body.toLowerCase();
    if (body.length < 25 || ['ok', 'okay', 'yes', 'no', 'thx', 'thanks', 'k', 'yep', 'yup', 'sure'].includes(lower)) {
      briefHits += 1;
    }
    if (lower.includes('thank you') || lower.includes('appreciate') || lower.includes('sir') || lower.includes("ma'am") || lower.includes('maam') || lower.includes('please ') || lower.includes('kindly ')) {
      formalHits += 1;
    }
  }

  if (n < 3) return { style: 'unknown', sample_count: n };
  const avg = totalChars / n;
  const briefPct = (briefHits / n) * 100;
  const formalPct = (formalHits / n) * 100;

  let style = 'conversational';
  if (briefPct >= 60 || avg < 25) style = 'brief';
  else if (formalPct >= 30) style = 'formal';

  return { style, sample_count: n, avg_chars: Math.round(avg), brief_pct: Math.round(briefPct), formal_pct: Math.round(formalPct) };
}

function shapeForStyle({ intro, inlineDetail, portalActionLabel }, style) {
  const i = String(intro || '').trim();
  const d = String(inlineDetail || '').trim();
  const p = String(portalActionLabel || '').trim();
  switch (style) {
    case 'brief':
      // No softening, no extra connective words. Single line if possible.
      return {
        intro: i.replace(/^great news[, ]+/i, '').replace(/^hi [^—-]+ — /i, ''),
        inlineDetail: d.split(/\.\s+/)[0],  // first sentence only
        portalActionLabel: p,
      };
    case 'formal':
      return {
        intro: i,
        inlineDetail: d ? d + ' We appreciate your patience.' : 'We appreciate your patience.',
        portalActionLabel: p,
      };
    case 'conversational':
      return { intro: i, inlineDetail: d, portalActionLabel: p };
    default:
      return { intro: i, inlineDetail: d, portalActionLabel: p };
  }
}

function cap(s) {
  const t = String(s || '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}
