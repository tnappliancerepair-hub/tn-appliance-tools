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
    text: "Hi {first} — {tech} from {shop} is on the way. See you soon! 🚚",
  },
  arrived: {
    on: true, label: 'Tech arrived', help: 'Sent when the tech starts the job on site.',
    vars: ['first', 'shop', 'tech'],
    text: "Hi {first} — {tech} from {shop} has arrived and is getting started. 🔧",
  },
  complete: {
    on: true, label: 'Repair complete + receipt', help: 'Sent when the job is finished. {link} = their receipt/summary.',
    vars: ['first', 'shop', 'link'],
    text: "Hi {first} — your repair with {shop} is complete. ✅ Your summary + receipt: {link}",
  },
  review: {
    on: true, label: 'Review request', help: 'Sent after completion. {review} = your Google review link.',
    vars: ['first', 'shop', 'review'],
    text: "Hi {first}, how did {shop} do today? If we earned it, a quick Google review means the world 🙏 {review} — and if anything was off, just reply here and we'll make it right.",
  },
  offer: {
    on: true, label: 'Schedule offer', help: 'Sent when the office offers the customer a day. {link} = tap-to-confirm.',
    vars: ['first', 'shop', 'day', 'link'],
    text: "{shop}: we can come out {day} for your repair. Tap to confirm, or pick a different day: {link}",
  },
  assigned: {
    on: true, label: 'Tech job alert (to your tech)', help: 'Internal — texts the tech when a job lands on their plate.',
    vars: ['shop', 'first', 'unit', 'problem', 'day', 'link'],
    text: "{shop}: new job — {first}{unit} · {problem} · {day}. Open your app: {link}",
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

// Convenience: resolved + rendered message, or null when the shop turned it off.
function msg(settings, key, vars) {
  const r = commsFor(settings, key);
  if (!r.on) return null;
  return render(r.text, vars || {});
}

module.exports = { DEFAULTS, render, commsFor, msg };
