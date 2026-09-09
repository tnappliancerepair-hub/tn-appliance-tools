// _lib/comms.js — the per-shop customer-communication model. ONE source of truth for every
// automated text: whether it's on, and the exact wording. Each shop overrides these on the
// Communication Center (platform/comms.html); nothing here fires unless the shop leaves it on.
// The browser twin (platform/comms-config.js) MUST keep the same ids + default copy in sync.
'use strict';

// id -> { on (default), label, help, vars (placeholders the message supports), text (default copy) }
const DEFAULTS = {
  reminder: {
    on: true, label: 'Day-before reminder', help: 'Sent the morning before the appointment.',
    vars: ['first', 'shop', 'tech', 'day', 'unit'],
    text: "Hi {first}, a reminder from {shop}: {tech} is scheduled to come out {day} for your {unit}. Reply here with any questions or to reschedule.",
  },
  otw: {
    on: true, label: 'On my way', help: 'Sent when the tech taps "On my way".',
    vars: ['first', 'shop', 'tech'],
    text: "Hi {first}, {tech} from {shop} is on the way. See you soon!",
  },
  arrived: {
    on: true, label: 'Tech arrived', help: 'Sent when the tech starts the job on site.',
    vars: ['first', 'shop', 'tech'],
    text: "Hi {first}, {tech} from {shop} has arrived and is getting started.",
  },
  complete: {
    on: true, label: 'Repair complete + receipt', help: 'Sent when the job is finished. {link} = their receipt/summary.',
    vars: ['first', 'shop', 'link'],
    text: "Hi {first}, your repair with {shop} is complete. Your summary + receipt: {link}",
  },
  review: {
    on: true, label: 'Review request', help: 'Sent after completion. Needs your review link (Settings) or it will not send.',
    vars: ['first', 'shop', 'tech', 'review'],
    text: "Hi {first}, thanks for your business today. If {tech} did right by you, a quick review means a lot: {review}",
  },
  review_nudge: {
    on: true, label: 'Review nudge (one, 3 days later)', help: 'One gentle second ask, only if they never replied. Turn off to ask once.',
    vars: ['first', 'shop', 'tech', 'review'],
    text: "Hi {first}, if you already left us a review, thank you. If not, it takes 30 seconds and helps a lot: {review}",
  },
  offer: {
    on: true, label: 'Schedule offer', help: 'Sent when the office offers the customer a day. {link} = tap-to-confirm.',
    vars: ['first', 'shop', 'day', 'link'],
    text: "{shop}: we can come out {day} for your repair. Tap to confirm, or pick a different day: {link}",
  },
  assigned: {
    on: true, label: 'Tech job alert (to your tech)', help: 'Internal — texts the tech when a job lands on their plate.',
    vars: ['shop', 'first', 'unit', 'problem', 'day', 'link'],
    text: "{shop}: new job - {first}{unit}, {problem}, {day}. Open your app: {link}",
  },
};

// Fill {placeholders} from vars; unknown/empty placeholders collapse to "".
function render(tpl, vars) {
  return String(tpl == null ? '' : tpl).replace(/\{(\w+)\}/g, function (m, k) {
    return (vars && vars[k] != null) ? String(vars[k]) : '';
  }).replace(/\s{2,}/g, ' ').trim();
}

// Resolve one message for a company: { on, text } — shop override else default.
function commsFor(settings, key) {
  const d = DEFAULTS[key] || { on: true, text: '' };
  const c = (settings && settings.comms && settings.comms[key]) || {};
  const text = (c.text && String(c.text).trim()) ? String(c.text) : d.text;
  return { on: c.on !== false && d.on !== false, text: text };
}

// Resolve the shop's review link. A review ask is only worth sending if the link opens a place
// a customer can actually LEAVE a review — a plain Google *search* URL is a dead end (they land
// on results and have to hunt for the write-a-review box), which is why an unset link used to
// quietly burn the one ask we get per job. ok=false means: do not send, tell the shop to set it.
//   { url, ok, why }   why: '' | 'not_set' | 'search_page' | 'not_a_url'
function reviewLink(settings) {
  const raw = String((settings && settings.review_url) || '').trim();
  if (!raw) return { url: '', ok: false, why: 'not_set' };
  let url = raw;
  if (!/^https?:\/\//i.test(url)) {
    // tolerate a pasted bare link (g.page/r/…/review, maps.app.goo.gl/…, facebook.com/…)
    if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(url)) url = 'https://' + url;
    else return { url: '', ok: false, why: 'not_a_url' };
  }
  // a Google search results page cannot take a review
  if (/^https?:\/\/(www\.)?google\.[a-z.]+\/search\b/i.test(url)) return { url: url, ok: false, why: 'search_page' };
  return { url: url, ok: true, why: '' };
}

// Plain-English reason a shop's review asks are paused — for the owner, not the customer.
const REVIEW_LINK_HELP = {
  not_set: 'no review link set',
  not_a_url: 'the review link is not a valid web address',
  search_page: 'the review link is a Google search page, not a review page',
};

// Convenience: resolved + rendered message, or null when the shop turned it off.
function msg(settings, key, vars) {
  const r = commsFor(settings, key);
  if (!r.on) return null;
  return render(r.text, vars || {});
}

module.exports = { DEFAULTS, render, commsFor, msg, reviewLink, REVIEW_LINK_HELP };
