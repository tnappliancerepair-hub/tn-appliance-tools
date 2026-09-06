// lead-magnet — PUBLIC capture for the free "24/7 AI Answering + Triage Playbook" (the appliance-shop
// lead magnet). A cold prospect gives name + email/phone to get the free guide; this (1) captures the
// lead durably in the platform `prospect_message` table (source `lead_magnet`), (2) pings Teddy both ways
// so he can follow up warm, and (3) best-effort emails the prospect the guide (works once EMAIL_ENABLED;
// never blocks). The guide itself is revealed INLINE on the thank-you page, so delivery never depends on
// the email flag. Bot-guarded by a honeypot; never charges, never provisions. Mirrors platform-contact.js.
//
//   POST { name, phone?, email?, shop?, source?, company_website? }  ->  { ok, message }
'use strict';

const { platform } = require('./_lib/platform-rest');
const notify = require('./_lib/platform-notify');
const { getSecret } = require('./_lib/secrets');

function J(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 400);
const SITE = 'https://tnapplianceexchange.net';
const GUIDE_TITLE = 'The 24/7 AI Answering + Triage Playbook for Appliance Shops';

// The emailed copy of the guide (the full version also renders on the thank-you page). Plain text so it
// lands clean in any inbox; the email is a bonus — the page reveal is the primary delivery.
function guideEmailBody(first) {
  return [
    `Hey${first ? ' ' + first : ''},`,
    ``,
    `Here's the playbook — this is exactly how we answer every call and triage jobs at TN Appliance Exchange.`,
    ``,
    `1) THE 24/7 CALL SCRIPT (collect these on every call, no exceptions):`,
    `   • Brand + model number (the model # is everything — get it)`,
    `   • The symptom in the customer's own words`,
    `   • Age of the unit + stacked or side-by-side (for laundry)`,
    `   • Under warranty? (home warranty / manufacturer / none)`,
    `   • Address + when they're available`,
    `   Get those five and any assistant can book a real, workable job — no appliance experience needed.`,
    ``,
    `2) THE WRITE-ONCE TRIAGE RULES (write your shop's version once, then it just runs):`,
    `   • "This symptom on this brand = bring this part on the first visit."`,
    `   • "This one = quote-first visit (diagnostic fee, no part)."`,
    `   • "This one = we don't take (out of area / not our appliance / not worth it)."`,
    `   That list is your triage. It came out of your head in two evenings and never has to be re-taught.`,
    ``,
    `3) WARRANTY DISPATCHES (where the money leaks):`,
    `   • Capture the claim # + dispatch # on intake so nothing gets lost.`,
    `   • Track authorization + parts-return per job — an un-returned part = a chargeback.`,
    `   • Every dispatch on ONE board, not five portals.`,
    ``,
    `4) THE MATH: every missed call is a missed job. A phone that's answered 24/7 — 2am, Sunday, doesn't`,
    `   matter — is the single highest-ROI thing in the shop.`,
    ``,
    `That's the whole playbook. If you'd rather it just RUN itself — the AI answering, the triage, the`,
    `board, the warranty tracking — that's what we built (AssistAnt). It's $100/mo flat, every tech`,
    `included, and you can bring your book over off Housecall Pro / Jobber / Workiz in an afternoon and`,
    `keep your old system running until you're sure. See it: ${SITE}/ant  — or just reply and I'll show you.`,
    ``,
    `— Teddy, TN Appliance Exchange`,
  ].join('\n');
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return J(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = event.body ? JSON.parse(event.body) : {}; } catch (_) {}

  // Honeypot: a real person leaves this hidden field blank; a bot fills it. Silently "succeed" + drop.
  if (s(b.company_website, 200)) return J(200, { ok: true, message: 'Sent — check your email.' });

  const name = s(b.name, 120);
  const phone = s(b.phone, 40);
  const email = s(b.email, 160);
  const shop = s(b.shop, 160);
  const source = s(b.source, 60) || 'lead_magnet';
  const first = (name.split(/\s+/)[0] || '');

  if (!name) return J(400, { ok: false, error: 'name_required', message: 'Add your name so we know who to send it to.' });
  if (!email && !phone) return J(400, { ok: false, error: 'contact_required', message: 'Add an email or phone so we can send the guide.' });

  // 1) Durable capture (best-effort — even if this write fails, the notify below still delivers the lead).
  try {
    const pf = await platform();
    if (pf) await pf.insert('prospect_message', {
      name, phone, email, shop, source,
      message: `Requested the free guide: "${GUIDE_TITLE}"`,
    });
  } catch (_) {}

  // 2) Ping Teddy both ways so he can follow up warm.
  const who = name || shop || email || phone || 'A prospect';
  const reach = [phone && ('📞 ' + phone), email && ('✉️ ' + email)].filter(Boolean).join('  ');
  try {
    await notify.notifyOperator({
      tag: 'prospect_message', // office-gate lets this through to Teddy's cell
      sms: `📘 Free-guide lead: ${who}${shop && shop !== name ? ' (' + shop + ')' : ''} — ${reach}. (${source})`,
      subject: `AssistAnt free-guide lead — ${who}`,
      email_body: `New free-guide request (${source}).\n\nName: ${name || '—'}\nShop: ${shop || '—'}\nPhone: ${phone || '—'}\nEmail: ${email || '—'}\n\nThey grabbed "${GUIDE_TITLE}" — good warm DM target.\n\nReceived: ${new Date().toISOString()}`,
    });
  } catch (_) {}

  // 3) Best-effort: email the prospect the guide (works once EMAIL_ENABLED; NEVER blocks the thank-you,
  //    which already reveals the full guide inline). Only if they gave an email.
  let emailed = false;
  try {
    const shared = await getSecret('EMAIL_SHARED_SECRET');
    if (shared && email) {
      const r = await fetch(`${SITE}/.netlify/functions/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Auth': shared },
        body: JSON.stringify({
          to: email,
          subject: GUIDE_TITLE,
          body: guideEmailBody(first),
          replyTo: 'tnappliancerepair@gmail.com',
        }),
        signal: AbortSignal.timeout(9000),
      });
      const d = await r.json().catch(() => ({}));
      emailed = !!(r.ok && d.mode === 'live');
    }
  } catch (_) {}

  return J(200, { ok: true, emailed, message: 'Here’s your playbook — scroll down.' });
};
