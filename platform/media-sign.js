// media-sign.js — turns tenant-scoped media refs into short-lived SIGNED URLs on the staff
// apps. Media now lives in Cloudflare R2 (private, zero-egress); the platform-media-urls
// function signs a batch of refs but ONLY the caller's own tenant's objects (it verifies the
// staff Supabase session and folder-prefix-matches each ref to that company). Any element with
// data-ph="<ref>" (img/video src) or data-phhref="<ref>" (link href) is auto-filled with a
// signed URL after render. A MutationObserver keeps up with re-renders.
(function () {
  var cfg = window.ANT_SUPABASE || {};
  var sb = null;
  try { if (cfg.url && window.supabase) sb = window.supabase.createClient(cfg.url, cfg.anonKey); } catch (_) {}
  var cache = {};  // ref -> signed url
  var timer = null;

  function apply() {
    document.querySelectorAll('[data-ph]:not([data-phdone])').forEach(function (el) {
      var r = el.getAttribute('data-ph');
      if (cache[r]) { el.src = cache[r]; el.setAttribute('data-phdone', '1'); }
    });
    document.querySelectorAll('[data-phhref]:not([data-phhrefdone])').forEach(function (el) {
      var r = el.getAttribute('data-phhref');
      if (cache[r]) { el.href = cache[r]; el.setAttribute('data-phhrefdone', '1'); }
    });
  }
  function run() {
    if (!sb) return;
    var refs = {};
    document.querySelectorAll('[data-ph]:not([data-phdone]),[data-phhref]:not([data-phhrefdone])').forEach(function (el) {
      var r = el.getAttribute('data-ph') || el.getAttribute('data-phhref');
      if (r && !cache[r]) refs[r] = 1;
    });
    var need = Object.keys(refs);
    if (!need.length) { apply(); return; }
    sb.auth.getSession().then(function (res) {
      var tok = res && res.data && res.data.session && res.data.session.access_token;
      if (!tok) return;
      return fetch('/.netlify/functions/platform-media-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
        body: JSON.stringify({ refs: need })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.urls) Object.keys(d.urls).forEach(function (k) { if (d.urls[k]) cache[k] = d.urls[k]; });
        apply();
      });
    }).catch(function () {});
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(run, 100); }
  if (document.body) { new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); run(); }
  else document.addEventListener('DOMContentLoaded', function () { new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); run(); });
  window.antMediaResign = run;
})();
