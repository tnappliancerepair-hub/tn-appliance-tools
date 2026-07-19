/* meta-pixel.js — TN Appliance Exchange · Meta (Facebook) Pixel.
   Passive visitor tracking for retargeting + ad measurement. Dataset/Pixel ID 1441529794691715.
   Fires a standard PageView on every load. No PII sent — Meta's own base code. Loaded in <head>
   on customer-facing pages only (internal tool pages are intentionally excluded). Installed 2026-07-19.
   To add conversion events later: fbq('track','Lead') on booking/intake submit, fbq('track','Purchase',{value,currency})
   on payment success. Kill switch: remove the /meta-pixel.js tag or empty this file. */
!function (f, b, e, v, n, t, s) {
  if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
  if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
  t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
}(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '1441529794691715');
fbq('track', 'PageView');
