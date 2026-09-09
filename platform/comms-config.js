// comms-config.js — browser twin of netlify/functions/_lib/comms.js. The Communication Center
// (comms.html) reads these defaults so a shop sees the real wording before it edits. KEEP THE ids
// + default copy in sync with _lib/comms.js (the server is the source that actually sends).
(function () {
  var DEFAULTS = {
    reminder: { on: true, label: 'Day-before reminder', help: 'Sent the afternoon before the appointment.', vars: ['first', 'shop', 'tech', 'day', 'unit'],
      text: "Hi {first}, a reminder from {shop}: {tech} is scheduled to come out {day} for your {unit}. Reply here with any questions or to reschedule." },
    otw: { on: true, label: 'On my way', help: 'Sent when the tech taps "On my way".', vars: ['first', 'shop', 'tech'],
      text: "Hi {first}, {tech} from {shop} is on the way. See you soon!" },
    arrived: { on: true, label: 'Tech arrived', help: 'Sent when the tech starts the job on site.', vars: ['first', 'shop', 'tech'],
      text: "Hi {first}, {tech} from {shop} has arrived and is getting started." },
    complete: { on: true, label: 'Repair complete + receipt', help: 'Sent when the job is finished. {link} = their receipt/summary.', vars: ['first', 'shop', 'link'],
      text: "Hi {first}, your repair with {shop} is complete. Your summary + receipt: {link}" },
    review: { on: true, label: 'Review request', help: 'Sent after completion. Needs your review link (Settings) or it will not send.', vars: ['first', 'shop', 'tech', 'review'],
      text: "Hi {first}, thanks for your business today. If {tech} did right by you, a quick review means a lot: {review}" },
    review_nudge: { on: true, label: 'Review nudge (one, 3 days later)', help: 'One gentle second ask, only if they never replied. Turn off to ask once.', vars: ['first', 'shop', 'tech', 'review'],
      text: "Hi {first}, if you already left us a review, thank you. If not, it takes 30 seconds and helps a lot: {review}" },
    offer: { on: true, label: 'Schedule offer', help: 'Sent when the office offers the customer a day. {link} = tap-to-confirm.', vars: ['first', 'shop', 'day', 'link'],
      text: "{shop}: we can come out {day} for your repair. Tap to confirm, or pick a different day: {link}" },
    assigned: { on: true, label: 'Tech job alert (to your tech)', help: 'Internal — texts the tech when a job lands on their plate.', vars: ['shop', 'first', 'unit', 'problem', 'day', 'link'],
      text: "{shop}: new job - {first}{unit}, {problem}, {day}. Open your app: {link}" },
  };
  // Order the cards are shown in (customer-facing first, tech alert last).
  var ORDER = ['reminder', 'otw', 'arrived', 'complete', 'review', 'review_nudge', 'offer', 'assigned'];
  // Sample values so a shop sees a realistic preview as it types.
  var SAMPLE = { first: 'Sarah', shop: 'your shop', tech: 'Lee', day: 'Thursday, Sep 4', unit: 'washer', problem: "won't drain", link: 'tnapp.co/r/ab12', review: 'https://g.page/r/CRt-vo--eAJ3EBM/review' };

  // --- carrier segment math. A text is billed per SEGMENT, not per message. Plain GSM-7 gets
  // 160 chars; ONE character outside that set (any emoji, an em dash, a curly quote, a middle
  // dot) flips the whole message to UCS-2 and the limit drops to 70 -- so a 90-char message
  // with one emoji bills as 2. Cost/segment measured off Telnyx billed records: $0.0122.
  var GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
  var GSMX = '^{}\\[~]|\u20ac';   // each costs 2
  var SEG_COST_CENTS = 1.22;
  // what it would cost with every non-GSM character removed -- the honest 'if you cleaned this up'
  function plainParts(s) {
    var n = 0, i, c;
    for (i = 0; i < s.length; i++) { c = s.charAt(i); if (GSM.indexOf(c) >= 0) n += 1; else if (GSMX.indexOf(c) >= 0) n += 2; }
    return n <= 160 ? 1 : Math.ceil(n / 153);
  }
  function segments(text) {
    var s = String(text == null ? '' : text), sep = 0, bad = [], i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charAt(i);
      if (GSM.indexOf(c) >= 0) sep += 1;
      else if (GSMX.indexOf(c) >= 0) sep += 2;
      else if (bad.indexOf(c) < 0) bad.push(c);
    }
    if (bad.length) {   // UCS-2: JS string length IS the UTF-16 unit count (emoji = 2)
      var shown = [], j;                                  // show whole emoji, not surrogate halves
      for (j = 0; j < bad.length; j++) {
        var cc = bad[j].charCodeAt(0);
        if (cc >= 0xD800 && cc <= 0xDBFF) { if (j + 1 < bad.length) { shown.push(bad[j] + bad[j + 1]); j++; } }
        else if (cc >= 0xDC00 && cc <= 0xDFFF) { /* lone low half, skip */ }
        else shown.push(bad[j]);
      }
      return { enc: 'UCS-2', units: s.length, parts: s.length <= 70 ? 1 : Math.ceil(s.length / 67),
               bad: shown, partsIfPlain: plainParts(s) };
    }
    return { enc: 'GSM-7', units: sep, parts: sep <= 160 ? 1 : Math.ceil(sep / 153), bad: [], partsIfPlain: sep <= 160 ? 1 : Math.ceil(sep / 153) };
  }
  function render(tpl, vars) { return String(tpl == null ? '' : tpl).replace(/\{(\w+)\}/g, function (m, k) { return (vars && vars[k] != null) ? String(vars[k]) : ''; }).replace(/\s{2,}/g, ' ').trim(); }
  window.AntComms = { DEFAULTS: DEFAULTS, ORDER: ORDER, SAMPLE: SAMPLE, render: render, segments: segments, SEG_COST_CENTS: SEG_COST_CENTS };
})();
