/* ant-thread.js — ONE definition of the shared conversation, mounted on every surface
   that shows it: the office inbox, the office board's job drawer, and the tech's job page.

   Danielle, 2026-09-15: something is wrong with the text messages. Measured before writing
   a line: 81% of every inbound row is a line one of our own functions composed — a waiver
   signature, a finished-intake marker, a mirrored warranty dispatch email — and all of it
   was rendering as blue CUSTOMER speech, burying the 239 real texts underneath.

   So the one rule this file owns is MESSAGE vs NOTE:
     message — a human said this. Customer, office, tech, or Ann. It gets a speech bubble.
     note    — we recorded that something happened. It gets a quiet centered line.

   It exists as a module for the same reason ant-part-route.js and ant-part-note.js do:
   three pages each rendering their own copy of this drifted three ways, and the office and
   the tech looking at the same conversation have to see the same thing.

     AntThread.mount(el, rows, opts)   render into el (scrolls to the newest)
     AntThread.isNote(m)               the rule, on its own, for callers that need it
     AntThread.isAck(m)                is this only a thank-you? (for "who is waiting on me")
     AntThread.speaker(m)              who said it, as a person reads it

   opts: { me:'office'|'tech'|'customer', customerName, emptyText }
*/
(function () {
  'use strict';
  if (window.AntThread) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // THE RULE. The kind column (migration 075) is the truth; the channel test behind it is
  // the safety net for any writer not yet taught to stamp it — every inbound row that is
  // not an SMS was machine-composed. Outbound is never inferred: some of our own rows are
  // the real text and some are a log line about having sent one, and wrongly hiding
  // something we told a customer is the expensive direction.
  function isNote(m) {
    if (!m) return false;
    if (String(m.kind || '') === 'note') return true;
    return m.direction === 'in' && String(m.channel || '') !== 'sms';
  }

  // IS THIS JUST AN ACKNOWLEDGEMENT? Different question from the office's 8-way intent
  // classifier in platform-unanswered.js — that one asks "what is this about, so I can draft
  // a reply". This one asks "does a human have to stop and read it".
  //
  // Validated against all 57 real customer-spoke-last rows on TN's live board, not invented:
  // roughly half are "Yes" / "Thanks" / "Perfect" / a tapback, and a tech who opens a list of
  // twelve and finds ten thank-yous stops opening the list. That is the documented way a
  // queue dies.
  //
  // ⚠️ THE SAFE DIRECTION IS TO SHOW, NOT HIDE — the opposite of a spam filter. A missed
  // "it's still not fixed" costs the job; an extra "Thank you!" costs one line of screen. So
  // this only returns true when the WHOLE message is an acknowledgement and nothing else:
  // "Yes, how long will it take to get the part?" is a question, not a yes.
  var ACK_WORDS = /^(ok|okay|k|yes|yea|yeah|yep|yup|sure|thanks|thank you|thanx|ty|thx|perfect|great|awesome|got it|sounds good|that works|this works|works for me|will do|see you( soon| then)?|see ya|appreciate it|no thank you|no thanks|you too|same to you|bye|cool|nice|excellent|10 4|10-4|copy|roger)$/;
  // A tapback REACTION quotes our own outbound text back at us, so the body can run 90
  // characters and still be a thumbs-up. The quoted half must never be read as the customer
  // talking. "Questioned" is deliberately NOT here — that reaction IS a question.
  var ACK_REACTION = /^\s*(liked|loved|laughed at|emphasized|disliked|gefällt|gefaellt)\s*[:：]?\s*[“"„']/i;
  var ACK_EMOJI_REACTION = /^\s*[​\s]*[❤👍👎😂😮‼️🤣💖]+[​\s]*(to|zu)\s*[“"„']/i;

  function isAck(m) {
    if (!m || m.direction !== 'in') return false;
    var raw = String(m.body || '');
    if (ACK_REACTION.test(raw) || ACK_EMOJI_REACTION.test(raw)) return true;
    // strip emoji, zero-width joiners and trailing punctuation, then compare the WHOLE thing
    var b = raw
      .replace(/[​-‏️]/g, '')
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[←-➿⬀-⯿]/g, ' ')
      .replace(/[^\w\s'-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!b) return true;                    // a bare 👍 with no words is an acknowledgement
    // allow one leading "ok"/"yes" before a thanks: "ok thanks", "yes thank u"
    b = b.replace(/^(ok|okay|yes|yeah|yep|yup)\s+(?=(thanks|thank you|thank u|ty|thx|that works|this works|perfect|great|sounds good))/, '');
    b = b.replace(/\bthank u\b/, 'thank you');
    return ACK_WORDS.test(b);
  }

  // Who said it. sender is 'office:Danielle' / 'tech:Jimmy' / 'ann' / 'customer', and on
  // rows teed over from the old system just a bare first name ('Lee', 'John') — so an
  // unrecognised sender is shown as itself rather than swallowed into a generic 'Us'.
  function speaker(m, opts) {
    var s = String((m && m.sender) || '').trim();
    var o = opts || {};
    if (m && m.direction === 'in') {
      return '👤 ' + (o.customerName || (s && s !== 'customer' ? s : 'Customer'));
    }
    if (/^office:/i.test(s)) return '🏢 ' + s.slice(7);
    if (/^tech:/i.test(s)) return '🔧 ' + s.slice(5);
    if (s === 'office') return '🏢 Office';
    if (s === 'tech') return '🔧 Tech';
    if (s === 'ann' || s === '') return '🐜 Ann';
    if (s === 'system') return 'Ant';
    return s;
  }

  // ⚠️ THE CEILING, AND IT IS NOT A BUILD PROBLEM: **SMS has no "read".** No carrier reports
  // one. The strongest true thing anyone can say about a text is that the handset received
  // it. So this says DELIVERED and never "read" / "opened" / "seen" — telling a tech a
  // customer read something we only know was delivered is how he stops trusting the tool.
  // Nothing at all is shown until the carrier tells us, because a silent bubble is honest
  // and a wrong tick is not.
  function receipt(m) {
    if (!m || m.direction !== 'out') return '';
    var st = String(m.delivery_status || '');
    if (st === 'delivered') return '<span class="anth-rcpt anth-ok">✓ Delivered</span>';
    if (st === 'failed') return '<span class="anth-rcpt anth-bad">⚠ Did NOT reach their phone</span>';
    return '';
  }

  function when(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso), now = new Date();
      var sameDay = d.toDateString() === now.toDateString();
      var t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      return sameDay ? t : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + t;
    } catch (_) { return ''; }
  }
  function dayOf(iso) {
    try {
      var d = new Date(iso), now = new Date();
      if (d.toDateString() === now.toDateString()) return 'Today';
      var y = new Date(now); y.setDate(y.getDate() - 1);
      if (d.toDateString() === y.toDateString()) return 'Yesterday';
      return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    } catch (_) { return ''; }
  }

  var CSS = [
    // No padding/height here on purpose: every host already sizes its own scroller (the
    // inbox panel, the drawer's 260px box, the tech card's 340px box). This class only
    // guarantees the two things the bubbles need — a column, and momentum scrolling on
    // a phone — so mounting it can never fight the page's own layout.
    '.anth{display:flex;flex-direction:column;gap:7px;overflow-y:auto;-webkit-overflow-scrolling:touch}',
    '.anth-day{align-self:center;font-size:11px;font-weight:700;opacity:.55;letter-spacing:.02em;margin:6px 0 1px;text-transform:uppercase}',
    '.anth-b{max-width:82%;padding:8px 11px;border-radius:14px;line-height:1.4;font-size:14px;word-break:break-word;white-space:pre-wrap}',
    '.anth-in{align-self:flex-start;background:rgba(127,127,127,.16);border-bottom-left-radius:5px}',
    '.anth-out{align-self:flex-end;background:#2563eb;color:#fff;border-bottom-right-radius:5px}',
    '.anth-who{display:block;font-size:10.5px;font-weight:700;opacity:.72;margin-bottom:2px}',
    '.anth-at{display:block;font-size:10px;opacity:.6;margin-top:3px;text-align:right}',
    '.anth-rcpt{font-size:10px;font-weight:700;margin-left:6px}',
    '.anth-ok{opacity:.8}',
    '.anth-bad{color:#fecaca}',
    // A note is a fact about the job, not speech — so it never gets a bubble or a side.
    '.anth-note{align-self:center;max-width:94%;text-align:center;font-size:12px;opacity:.7;padding:3px 10px;line-height:1.4}',
    '.anth-empty{opacity:.65;font-size:13px;padding:6px 2px}',
  ].join('');

  function css() {
    if (document.getElementById('anth-css')) return;
    var st = document.createElement('style'); st.id = 'anth-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  function mount(el, rows, opts) {
    if (!el) return { notes: 0, messages: 0 };
    css();
    var o = opts || {};
    rows = Array.isArray(rows) ? rows : [];
    if (!el.classList.contains('anth')) el.classList.add('anth');
    if (!rows.length) {
      el.innerHTML = '<div class="anth-empty">' + esc(o.emptyText || 'No messages yet.') + '</div>';
      return { notes: 0, messages: 0 };
    }
    var html = '', lastDay = '', notes = 0, messages = 0;
    for (var i = 0; i < rows.length; i++) {
      var m = rows[i];
      var d = dayOf(m.created_at);
      if (d && d !== lastDay) { html += '<div class="anth-day">' + esc(d) + '</div>'; lastDay = d; }
      if (isNote(m)) {
        notes++;
        html += '<div class="anth-note">' + esc(m.body || '') + '</div>';
      } else {
        messages++;
        var out = m.direction === 'out';
        html += '<div class="anth-b ' + (out ? 'anth-out' : 'anth-in') + '">' +
          '<span class="anth-who">' + esc(speaker(m, o)) + '</span>' +
          esc(m.body || '') +
          '<span class="anth-at">' + esc(when(m.created_at)) + receipt(m) + '</span>' +
          '</div>';
      }
    }
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
    return { notes: notes, messages: messages };
  }

  window.AntThread = { mount: mount, isNote: isNote, isAck: isAck, speaker: speaker, when: when, receipt: receipt };
})();
