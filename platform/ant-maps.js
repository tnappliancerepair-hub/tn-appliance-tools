// ant-maps.js — THE navigation catalog for the platform. One definition, every surface.
// Drop <script src="/platform/ant-maps.js"></script> on any page that hands a tech an address.
//
// Andre, 2026-09-15: "can we add Apple Maps".
//
// He was right that it was missing. Every navigate link on the platform was hardcoded to
// maps.google.com — six of them across tech.html, tech-job.html, dispatch.html and
// job-view.html. On an iPhone that bounces the tech through a browser page on the way to the
// app he actually drives with. Four of the five techs are on iPhones.
//
// ⚠️ THE ONE RULE HERE: detection may only ever REORDER, never REMOVE.
// Both maps are always rendered and always spelled out by name, so a tech reads the app he
// uses and taps it. If the Apple sniff below is ever wrong — a new iPad UA, a Mac in some
// desktop mode — the worst case is the buttons are in the other order. Nobody loses the tool
// they know. That is deliberate: a tech in a driveway is the wrong place to discover that a
// clever platform guess took his map away.
//
// Apple gets ?daddr= (start directions from where I am) because that is what a tech means by
// "navigate". Google deliberately keeps ?q= — its long-standing behaviour on this board —
// so adding Apple Maps changes nothing for the techs already using Google.
(function (root) {
  'use strict';

  // Apple devices: iPhone/iPad/iPod outright, a Mac by platform, and an iPad masquerading as
  // a Mac (iPadOS 13+ reports "Macintosh" and is the one modern UA that needs the touch test).
  function isApple() {
    try {
      var ua = (root.navigator && root.navigator.userAgent) || '';
      var plat = (root.navigator && root.navigator.platform) || '';
      if (/iPhone|iPad|iPod/.test(ua) || /iPhone|iPad|iPod/.test(plat)) return true;
      if (/Mac/.test(plat) || /Macintosh/.test(ua)) return true;
      return false;
    } catch (_) { return false; }
  }

  function clean(addr) { return String(addr == null ? '' : addr).trim(); }

  // Directions from the tech's current location, straight into Apple Maps.
  function appleUrl(addr) {
    return 'https://maps.apple.com/?daddr=' + encodeURIComponent(clean(addr));
  }
  // Unchanged from what every surface already shipped — a Google Maps pin on the address.
  function googleUrl(addr) {
    return 'https://maps.google.com/?q=' + encodeURIComponent(clean(addr));
  }
  // The single best link when there is only room for one (the tappable 📍 address line).
  function primaryUrl(addr) { return isApple() ? appleUrl(addr) : googleUrl(addr); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Both maps, named, device-native first. `cls` lets a host page keep its own link styling.
  function linksHtml(addr, cls) {
    var a = clean(addr);
    if (!a) return '';
    var c = cls ? ' class="' + esc(cls) + '"' : '';
    var apple = '<a' + c + ' target="_blank" rel="noopener" href="' + esc(appleUrl(a)) + '">🧭 Apple Maps</a>';
    var google = '<a' + c + ' target="_blank" rel="noopener" href="' + esc(googleUrl(a)) + '">🗺️ Google Maps</a>';
    return isApple() ? (apple + google) : (google + apple);
  }

  root.AntMaps = {
    isApple: isApple,
    appleUrl: appleUrl,
    googleUrl: googleUrl,
    primaryUrl: primaryUrl,
    linksHtml: linksHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
