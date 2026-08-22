// ant-track.js — conversion + attribution tracking. One tag per page, site-wide:
//   <script src="/ant-track.js" defer></script>
//
// Answers "where does the work come from?" two ways:
//  1) Fires GA4 events for the actions that turn into jobs — CALL taps (tel:) and
//     INTAKE starts (any link to /appliance-ai or /book-repair, or the floating
//     launcher) — tagged with the current page + the channel/first page the visitor
//     arrived on. So GA4 shows call-intent + intake-starts BY PAGE and BY SOURCE.
//  2) Captures FIRST-TOUCH attribution (the page + channel they entered the site on)
//     and exposes window.antAttribution() so the intake can stamp every created job
//     with its true source (see appliance-ai.html recordLeadSource()).
//
// Pure client-side, no deps, never blocks. gclid/ads attribution stays in
// appliance-ai.html (tn_ad_click); this is the general lead-source layer.
(function () {
  'use strict';
  var LS = 'tn_attribution';

  // Resolve the acquisition channel. Order matters — the whole point is to split the
  // three things that used to all read as "google" so the office can tell what's working:
  //   gbp        = Google Business Profile / map pack (tag the GBP website link with
  //                ?utm_source=gbp, or a maps.google referrer) — the free local engine
  //   google_ads = a PAID Google click (gclid/gbraid/wbraid present) — LSA or Search ads
  //   lsa        = Local Services Ad (tag its link ?utm_source=lsa) if it carries no gclid
  //   google     = organic blue-link search
  // Explicit utm_source always wins; then a paid click; then referrer host. Without the
  // GBP-link UTM a map-pack click off the main results page looks identical to organic
  // (both referrer google.com), so the utm_source=gbp tag is what makes map pack countable.
  function channelOf(ref, utmSource, gclid) {
    if (utmSource) return String(utmSource).toLowerCase();
    if (gclid) return 'google_ads';
    if (!ref) return 'direct';
    try {
      var h = new URL(ref).hostname.replace(/^www\./, '');
      var self = (location.hostname || '').replace(/^www\./, '');
      if (self && h === self) return 'internal';
      // Map pack / Business Profile BEFORE the generic google check — else maps.google.com
      // (has ".google.") gets mislabeled 'google' and map-pack clicks vanish into organic.
      if (/(g\.co|maps\.google|business\.google|local\.google|goo\.gl\/maps)/.test(h)) return 'gbp';
      if (/(^|\.)google\./.test(h)) return 'google';
      if (/(^|\.)bing\./.test(h)) return 'bing';
      if (/duckduckgo|yahoo|ecosia/.test(h)) return 'search';
      if (/(facebook|fb\.com|fb\.me|instagram|t\.co|twitter|x\.com|tiktok|youtube|youtu\.be|linkedin|truthsocial)/.test(h)) return 'social';
      return h;
    } catch (_) { return 'referral'; }
  }

  // 1) FIRST-TOUCH — set once, never overwritten (the real acquisition source).
  try {
    if (!localStorage.getItem(LS)) {
      var u = new URLSearchParams(location.search);
      var utmSource = u.get('utm_source') || '';
      var gclid = u.get('gclid') || u.get('gbraid') || u.get('wbraid') || '';
      var rec = {
        landing: location.pathname,
        ref: (document.referrer || '').slice(0, 300),
        channel: channelOf(document.referrer || '', utmSource, gclid),
        utm_source: utmSource,
        utm_medium: u.get('utm_medium') || '',
        utm_campaign: u.get('utm_campaign') || '',
        gclid: u.get('gclid') || '',
        t: Date.now()
      };
      localStorage.setItem(LS, JSON.stringify(rec));
    }
  } catch (_) {}

  window.antAttribution = function () {
    try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch (_) { return null; }
  };

  // 2) CONVERSION-INTENT CLICKS -> GA4
  function attrTags() {
    var a = window.antAttribution() || {};
    return { first_page: a.landing || '', lead_channel: a.channel || 'direct', campaign: a.utm_campaign || '' };
  }
  function fire(name, extra) {
    try {
      if (window.gtag) window.gtag('event', name, Object.assign({ page_path: location.pathname }, attrTags(), extra || {}));
    } catch (_) {}
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    var a = t && t.closest ? t.closest('a,button') : null;
    if (!a) return;
    var href = (a.getAttribute && a.getAttribute('href')) || '';
    if (/^tel:/i.test(href)) fire('call_click', { number: href.replace(/^tel:/i, '') });
    else if (/^sms:/i.test(href)) fire('text_click', {});
    else if (/\/(appliance-ai|book-repair)\b/.test(href) || (a.id === 'ant-launcher')) fire('intake_click', { target: href || 'launcher' });
  }, true);
})();

// Load the swappable Amazon-equivalent link layer. It self-gates (enabled flag +
// page-type denylist), so this is a no-op on app pages and stays invisible until
// the Associates tag is set and enabled:true is flipped in ant-amazon.js.
(function () {
  try {
    var s = document.createElement('script');
    s.src = '/ant-amazon.js'; s.defer = true;
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}
})();

// The 24/7·365 "we answer" moat bar — self-gates to public customer pages, dismissable.
(function () {
  try {
    var s = document.createElement('script');
    s.src = '/ant-open-badge.js'; s.defer = true;
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}
})();

// THE Easy Button — one-tap "broken machine? we've got it." Self-gates to public
// customer pages; real tel:/sms:/intake links, so the GA listeners above track taps.
(function () {
  try {
    var s = document.createElement('script');
    s.src = '/ant-easy-button.js'; s.defer = true;
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}
})();
