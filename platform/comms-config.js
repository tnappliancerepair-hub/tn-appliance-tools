// comms-config.js — browser twin of netlify/functions/_lib/comms.js. The Communication Center
// (comms.html) reads these defaults so a shop sees the real wording before it edits. KEEP THE ids
// + default copy in sync with _lib/comms.js (the server is the source that actually sends).
(function () {
  var DEFAULTS = {
    reminder: { on: true, label: 'Day-before reminder', help: 'Sent the afternoon before the appointment.', vars: ['first', 'shop', 'tech', 'day', 'unit'],
      text: "Hi {first}, a reminder from {shop}: {tech} is scheduled to come out {day} for your {unit}. Reply here with any questions or to reschedule." },
    otw: { on: true, label: 'On my way', help: 'Sent when the tech taps "On my way".', vars: ['first', 'shop', 'tech'],
      text: "Hi {first} — {tech} from {shop} is on the way. See you soon! 🚚" },
    arrived: { on: true, label: 'Tech arrived', help: 'Sent when the tech starts the job on site.', vars: ['first', 'shop', 'tech'],
      text: "Hi {first} — {tech} from {shop} has arrived and is getting started. 🔧" },
    complete: { on: true, label: 'Repair complete + receipt', help: 'Sent when the job is finished. {link} = their receipt/summary.', vars: ['first', 'shop', 'link'],
      text: "Hi {first} — your repair with {shop} is complete. ✅ Your summary + receipt: {link}" },
    review: { on: true, label: 'Review request', help: 'Sent after completion. {review} = your Google review link (set it in Settings).', vars: ['first', 'shop', 'review'],
      text: "Hi {first}, how did {shop} do today? If we earned it, a quick Google review means the world 🙏 {review} — and if anything was off, just reply here and we'll make it right." },
    offer: { on: true, label: 'Schedule offer', help: 'Sent when the office offers the customer a day. {link} = tap-to-confirm.', vars: ['first', 'shop', 'day', 'link'],
      text: "{shop}: we can come out {day} for your repair. Tap to confirm, or pick a different day: {link}" },
    assigned: { on: true, label: 'Tech job alert (to your tech)', help: 'Internal — texts the tech when a job lands on their plate.', vars: ['shop', 'first', 'unit', 'problem', 'day', 'link'],
      text: "{shop}: new job — {first}{unit} · {problem} · {day}. Open your app: {link}" },
  };
  // Order the cards are shown in (customer-facing first, tech alert last).
  var ORDER = ['reminder', 'otw', 'arrived', 'complete', 'review', 'offer', 'assigned'];
  // Sample values so a shop sees a realistic preview as it types.
  var SAMPLE = { first: 'Sarah', shop: 'your shop', tech: 'Lee', day: 'Thursday, Sep 4', unit: 'washer', problem: "won't drain", link: 'tnapp.co/r/ab12', review: 'g.page/your-shop/review' };
  function render(tpl, vars) { return String(tpl == null ? '' : tpl).replace(/\{(\w+)\}/g, function (m, k) { return (vars && vars[k] != null) ? String(vars[k]) : ''; }).replace(/\s{2,}/g, ' ').trim(); }
  window.AntComms = { DEFAULTS: DEFAULTS, ORDER: ORDER, SAMPLE: SAMPLE, render: render };
})();
