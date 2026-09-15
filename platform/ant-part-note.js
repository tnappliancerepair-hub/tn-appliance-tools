// ant-part-note.js — THE per-part conversation between the office and the tech. One
// definition, both surfaces. Drop <script src="/platform/ant-part-note.js"></script> on any
// page where somebody says something about a part.
//
// Teddy, 2026-09-15: "Whenever they're ordering the parts, which could be many days before,
// they need to be able to mark where those parts are so the tech knows where they're at. They
// need to be able to communicate back and forth on that... And if the tech doesn't need that,
// they need to be able to communicate back to the office. Like, hey, I didn't need this part.
// I need to return it. Or, hey, I used the part. The job's complete. Or, hey, I used this
// part, but I didn't need that part."
//
// WHY IT COULDN'T HAPPEN BEFORE. job.office_notes is the JOB's note -- it is two-way and it
// works, but it cannot say WHICH PART, and "I used this one but not that one" is a sentence
// about a row. Meanwhile the tech's Used / Return / Not-here tap wrote job_part.disposition
// and told NOBODY: no note, no chip, no text. Measured live on TN's own board -- 1,194 parts
// across 466 open jobs -- ship_to (where the part IS) was set on 25 of them and eta on 5, and
// of 495 'used' marks only THREE came from a tech; 492 are the Xano mirror. Nobody uses a
// button that has no effect.
//
// THE SHAPE:
//   * ONE TAP IS THE MESSAGE. A tech in a kitchen should not type. Tapping ✅ / ↩️ / ❌ writes
//     the sentence for him; the office changing a route or an ETA writes hers. Free text is
//     there when the tap isn't enough, not as the price of being heard.
//   * APPEND, NEVER REPLACE, and re-read live first -- the same rule job.office_notes earned
//     the hard way. Neither side can blank what the other just said.
//   * WHOEVER SPOKE LAST OWNS THE BALL. note_role is the entire unread signal: tech spoke ->
//     the office tile lights up; office spoke -> his card lights up. Answering takes it back.
//     Self-clearing, no read-receipt table, no per-user state to drift.
//
// Deliberately NOT thread_message: that is the CUSTOMER's thread and renders in their portal.
// Part numbers, cost and "the wrong one came" must never leak there.
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // The sentence a tap writes. Plain English on purpose -- the office reads this at 7am
  // deciding whether to chase a vendor, so it has to say what happened, not name a column.
  var SENTENCES = {
    used:     '✅ Used it on the job.',
    'return': "↩️ Didn't need this one — it's going back.",
    not_here: "❌ This one never showed up.",
    shelf:    '🏬 Kept it — it’s on our shelf at the shop.',
    cleared:  '↔️ Cleared that — this one is still open.'
  };
  function sentenceFor(action) { return SENTENCES[action] || ''; }

  // What the office's change says to the tech. Routes come from the one route catalog so the
  // note can never name a route the picker doesn't know.
  function routeSentence(ship_to, source, eta) {
    var where = '';
    if (ship_to && root.AntPartRoute) where = root.AntPartRoute.label(ship_to) || String(ship_to);
    else if (ship_to) where = String(ship_to);
    var bits = [];
    if (where) bits.push(where);
    if (source) bits.push('at ' + source);
    if (eta) bits.push('ETA ' + fmtDay(eta));
    return bits.length ? ('🔩 ' + bits.join(' · ')) : '';
  }

  function fmtDay(d) {
    if (!d) return '';
    var s = String(d).slice(0, 10).split('-');
    if (s.length !== 3) return String(d);
    var dt = new Date(+s[0], +s[1] - 1, +s[2]);
    if (isNaN(dt)) return String(d);
    return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function stamp(who, when) {
    var d = when ? new Date(when) : new Date();
    if (isNaN(d)) d = new Date();
    return '— ' + (who || 'Office') + ' · ' +
      d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // One line, attributed. Blank text yields blank so a no-op tap can never write an empty
  // signed line into the conversation.
  function line(text, who, when) {
    var t = String(text == null ? '' : text).trim();
    if (!t) return '';
    return stamp(who, when) + '\n' + t;
  }

  // APPEND. `live` is what is stored RIGHT NOW (re-read immediately before writing), never a
  // copy the page rendered from -- that copy is how the other side's line gets blanked.
  function append(live, text, who, when) {
    var add = line(text, who, when);
    if (!add) return String(live == null ? '' : live);
    var cur = String(live == null ? '' : live).replace(/\s+$/, '');
    return cur ? (cur + '\n\n' + add) : add;
  }

  // The write for either side. Returns the patch -- the caller owns the round trip so each
  // page keeps its own .select() + row-came-back check (a blocked write returns zero rows and
  // NO error; "no error" is never proof it saved).
  function patch(live, text, who, role) {
    var now = new Date();
    return {
      note: append(live, text, who, now),
      note_at: now.toISOString(),
      note_by: String(who || ''),
      note_role: role === 'tech' ? 'tech' : 'office'
    };
  }

  // WHO IS WAITING ON WHOM. The tech spoke last -> the office owes an answer, and vice versa.
  function techSpokeLast(p) { return !!(p && p.note_role === 'tech' && String(p.note || '').trim()); }
  function officeSpokeLast(p) { return !!(p && p.note_role === 'office' && String(p.note || '').trim()); }

  // A part the tech says never arrived is the loudest thing on the list -- somebody has to
  // chase a vendor TODAY. It is correctly left off the invoice (we never got it), but that is
  // a MONEY rule; hiding it from the office's attention surface is how the report gets buried.
  function isMissing(p) { return !!(p && p.disposition === 'not_here'); }

  // Read-only render of the conversation.
  function html(p, opts) {
    var o = opts || {};
    var body = String((p && p.note) || '').trim();
    if (!body) return o.emptyHtml || '';
    var who = techSpokeLast(p) ? 'tech' : (officeSpokeLast(p) ? 'office' : '');
    return '<div class="pnote' + (who ? ' pnote-' + who : '') + '">' + esc(body) + '</div>';
  }

  root.AntPartNote = {
    sentenceFor: sentenceFor,
    routeSentence: routeSentence,
    line: line,
    append: append,
    patch: patch,
    techSpokeLast: techSpokeLast,
    officeSpokeLast: officeSpokeLast,
    isMissing: isMissing,
    html: html,
    fmtDay: fmtDay
  };
})(typeof window !== 'undefined' ? window : globalThis);
