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

import { getCustomerChannelPreference } from './xano.js';

const MAX_SMS_CHARS = 320; // single-message ceiling we aim for

export async function composeForChannel({
  customerId,
  intro,           // short headline — e.g. "your parts arrived"
  inlineDetail,    // full info if we have to put it in the SMS — multi-line OK
  portalUrl,       // tnapplianceexchange.net/customer-portal.html?... if applicable
  portalActionLabel, // e.g. "pick a return-visit time"
  fallback,        // optional fallback body if everything else collapses
} = {}) {
  const pref = await getCustomerChannelPreference(customerId).catch(() => ({ prefers: 'unknown' }));
  const prefers = (pref && pref.prefers) || 'unknown';

  let body;
  if (prefers === 'portal' && portalUrl) {
    // They use the portal. Push them to it. Minimal SMS noise.
    body = portalActionLabel
      ? `[TN Appliance] ${intro}. ${cap(portalActionLabel)}: ${portalUrl}`
      : `[TN Appliance] ${intro}. Details: ${portalUrl}`;
  } else if (prefers === 'sms') {
    // They won't tap the portal. Put everything in the text.
    const inline = (inlineDetail || '').trim();
    body = `[TN Appliance] ${intro}.${inline ? '\n\n' + inline : ''}`;
    // No portal link — they've shown they ignore it.
  } else {
    // Unknown — safe default: short headline + portal link + inline
    // detail if it fits the SMS ceiling.
    const inline = (inlineDetail || '').trim();
    const head = portalUrl
      ? `[TN Appliance] ${intro}.${portalActionLabel ? ' ' + cap(portalActionLabel) + ': ' + portalUrl : ' ' + portalUrl}`
      : `[TN Appliance] ${intro}.`;
    if (inline && (head.length + inline.length + 2) <= MAX_SMS_CHARS) {
      body = head + '\n\n' + inline;
    } else {
      body = head;
    }
  }

  if (!body || body.trim() === '') body = fallback || '[TN Appliance] Update on your appointment — call 615-280-2949.';

  return { body, prefers, evidence: (pref && pref.evidence) || {} };
}

function cap(s) {
  const t = String(s || '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}
