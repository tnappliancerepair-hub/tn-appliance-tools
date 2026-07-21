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

  function channelOf(ref, utmSource) {
    if (utmSource) return utmSource;
    if (!ref) return 'direct';
    try {
      var h = new URL(ref).hostname.replace(/^www\./, '');
      var self = (location.hostname || '').replace(/^www\./, '');
      if (self && h === self) return 'internal';
      if (/(^|\.)google\./.test(h)) return 'google';
      if (/(^|\.)bing\./.test(h)) return 'bing';
      if (/duckduckgo|yahoo|ecosia/.test(h)) return 'search';
      if (/(facebook|fb\.com|fb\.me|instagram|t\.co|twitter|x\.com|tiktok|youtube|youtu\.be|linkedin|truthsocial)/.test(h)) return 'social';
      if (/(g\.co|maps\.google|business\.google|goo\.gl\/maps)/.test(h)) return 'gbp';
      return h;
    } catch (_) { return 'referral'; }
  }

  // 1) FIRST-TOUCH — set once, never overwritten (the real acquisition source).
  try {
    if (!localStorage.getItem(LS)) {
      var u = new URLSearchParams(location.search);
      var utmSource = u.get('utm_source') || '';
      var rec = {
        landing: location.pathname,
        ref: (document.referrer || '').slice(0, 300),
        channel: channelOf(document.referrer || '', utmSource),
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
