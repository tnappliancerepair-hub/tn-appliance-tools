// media-sign.js — turns tenant-scoped photo refs into short-lived SIGNED URLs on the
// staff apps (the intake-photos bucket is private; RLS lets a shop sign only its own
// company_id/... objects). Any element with data-ph="<ref>" (img/video src) or
// data-phhref="<ref>" (link href) is auto-filled with a 1-hour signed URL after render.
// A MutationObserver keeps up with re-renders, so pages don't change their render flow.
(function () {
  var cfg = window.ANT_SUPABASE || {};
  var sb = null;
  try { if (cfg.url && window.supabase) sb = window.supabase.createClient(cfg.url, cfg.anonKey); } catch (_) {}
  var cache = {}; // ref -> signed url
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
    sb.storage.from('intake-photos').createSignedUrls(need, 3600).then(function (res) {
      if (res && res.data) res.data.forEach(function (x) { if (x && x.signedUrl && x.path) cache[x.path] = x.signedUrl; });
      apply();
    }).catch(function () {});
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(run, 100); }
  if (document.body) { new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); run(); }
  else document.addEventListener('DOMContentLoaded', function () { new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); run(); });
  window.antMediaResign = run;
})();
