// ant-part-route.js — THE part-route catalog for the platform. One definition, every surface.
// Drop <script src="/platform/ant-part-route.js"></script> on any page that shows, picks, or
// counts where a part is coming from.
//
// Danielle + Jimmy, 2026-09-15, the same failure from both ends:
//   Danielle: "when I mark where it comes from i.e warranty or pick up marcones its not saving"
//   Jimmy:    "had parts at marcon's and had no clue"
//
// WHY IT LOOKED LIKE A SAVE BUG. job_part.ship_to carried TWO incompatible vocabularies:
//
//   the office board's <select>      'distributor' | 'customer'          (2 machine slugs)
//   platform-tn-parts-migrate        'Pickup — parts house'              (6 human strings,
//                                    'Pickup — shop/storage'              built from Xano's
//                                    'On the truck' | 'In hand'           notes.where_kind)
//                                    'Ship to customer' | 'To the shop'
//
// A mirrored row therefore matched NO <option>, so the browser fell back to the first one and
// the box read "Route…" — it looked like her pick never saved. Worse, the row's inline save
// writes every field at once, so the moment she touched the ETA next to it, ship_to went out
// as '' -> null and the real route was ERASED. 2,145 of 2,178 rows are null; that is the hole
// they went down.
//
// THE RULE HERE: a value we did not mint is still a value. Unknown free text is rendered as
// its own selected option, so it displays correctly and round-trips untouched. The picker can
// never blank something it simply didn't recognize.
(function (root) {
  'use strict';

  // The canonical picks, newest vocabulary first. `pickup:true` means the part is sitting
  // somewhere waiting for the tech — nobody is shipping it and nobody will text him when it
  // lands. That flag is the whole reason this file exists.
  var OPTIONS = [
    { value: 'distributor',           label: '🏭 Pick up from the distributor', pickup: true  },
    { value: 'Pickup — parts house',  label: '🏬 Will-call — pick up at the parts house', pickup: true  },
    { value: 'Pickup — shop/storage', label: '📦 Pick up at the shop / storage', pickup: true  },
    { value: 'On the truck',          label: '🚚 Already on the truck',         pickup: false },
    { value: 'In hand',               label: '✋ In hand',                       pickup: false },
    { value: 'customer',              label: "🏠 Shipping to the customer's home", pickup: false },
    { value: 'Ship to customer',      label: "🏠 Shipping to the customer's home", pickup: false },
    { value: 'To the shop',           label: '🏢 Shipping to the shop',          pickup: false }
  ];

  function norm(v) { return String(v == null ? '' : v).trim(); }

  function find(v) {
    var s = norm(v); if (!s) return null;
    for (var i = 0; i < OPTIONS.length; i++) if (OPTIONS[i].value === s) return OPTIONS[i];
    // tolerate case / dash drift from a hand-typed or re-encoded value
    var low = s.toLowerCase();
    for (var j = 0; j < OPTIONS.length; j++) if (OPTIONS[j].value.toLowerCase() === low) return OPTIONS[j];
    return null;
  }

  // Human label for ANY value — a known pick gets its label, anything else comes back as the
  // words somebody actually wrote. Never returns a guess.
  function label(v) { var o = find(v); return o ? o.label : norm(v); }

  // Is the tech expected to go GET this part? Falls back to reading the words, because the
  // route text can arrive from Xano in shapes this catalog has never seen.
  function isPickup(v) {
    var o = find(v); if (o) return !!o.pickup;
    var s = norm(v).toLowerCase(); if (!s) return false;
    return s.indexOf('pick') >= 0 || s.indexOf('will call') >= 0 || s.indexOf('will-call') >= 0;
  }

  // A <select> that ALWAYS carries the current value. An unrecognised value becomes its own
  // selected option, so editing any other field on the row cannot write null over it.
  function selectHtml(v, attrs) {
    var cur = norm(v), seen = false, html = '';
    html += '<select ' + (attrs || '') + '>';
    html += '<option value=""' + (cur === '' ? ' selected' : '') + '>Route…</option>';
    for (var i = 0; i < OPTIONS.length; i++) {
      var o = OPTIONS[i];
      // 'customer' and 'Ship to customer' read identically; only offer the first one, but
      // still keep whichever value this row actually holds selectable.
      var dupe = i > 0 && OPTIONS[i - 1].label === o.label && o.value !== cur;
      if (dupe) continue;
      var sel = (o.value === cur); if (sel) seen = true;
      html += '<option value="' + esc(o.value) + '"' + (sel ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }
    if (cur && !seen) html += '<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>';
    html += '</select>';
    return html;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  root.AntPartRoute = {
    OPTIONS: OPTIONS,
    label: label,
    isPickup: isPickup,
    selectHtml: selectHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
