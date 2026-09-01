// supa-guard — the "never a silent white screen" safety net for every platform page.
//
// WHY: the office/tech pages have a JS-only <body> and boot by calling
// window.supabase.createClient(...). If the supabase library didn't load (a corporate
// content-filter / ad-blocker / proxy blocking the CDN — exactly what a CSR hit on her
// locked-down desktop), createClient throws and the page is a blank white screen with no
// explanation. Self-hosting the library at /platform/vendor/supabase-js.js is the real
// fix; this is belt-and-suspenders: if the library STILL isn't there, show a friendly,
// self-healing panel instead of nothing.
//
// Load this RIGHT AFTER the supabase <script> on every page. If supabase loaded fine it's
// a no-op. If not, it drops a fixed full-screen overlay (covers whatever a crashing boot
// script leaves behind) that explains the likely cause + auto-reloads the moment the file
// becomes reachable or the network comes back.
(function () {
  if (window.supabase && typeof window.supabase.createClient === 'function') return;

  function show() {
    if (document.getElementById('ant-supa-guard')) return;
    var d = document.createElement('div');
    d.id = 'ant-supa-guard';
    d.setAttribute('style',
      'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;'
      + 'background:#0e120c;color:#eef2e8;text-align:center;padding:24px;'
      + 'font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif');
    d.innerHTML =
      '<div style="max-width:460px">'
      + '<div style="font-size:46px">🐜</div>'
      + '<h1 style="font-size:20px;margin:.5em 0 .3em;font-weight:800">Couldn’t load a component</h1>'
      + '<p style="opacity:.85;margin:0 0 4px">A file this page needs was blocked from loading — '
      + 'almost always an <b>ad-blocker</b>, <b>content filter</b>, or a <b>corporate proxy</b> on this network.</p>'
      + '<p style="opacity:.85;margin:0">Turn it off for this site (or try a different network / browser), then reload.</p>'
      + '<button id="ant-supa-reload" style="margin-top:18px;padding:13px 24px;border:0;border-radius:11px;'
      + 'background:#3f8f24;color:#fff;font-weight:800;font-size:16px;cursor:pointer">Reload</button>'
      + '<p style="opacity:.5;font-size:13px;margin-top:14px">Retrying automatically…</p>'
      + '</div>';
    (document.body || document.documentElement).appendChild(d);
    var b = document.getElementById('ant-supa-reload');
    if (b) b.onclick = function () { location.reload(); };
  }
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);

  // Self-heal: if the library file becomes reachable (deploy blip cleared, filter toggled
  // off) or the network comes back, reload so the whole page re-runs cleanly.
  var tries = 0;
  var timer = setInterval(function () {
    if (window.supabase && typeof window.supabase.createClient === 'function') { clearInterval(timer); location.reload(); return; }
    fetch('/platform/vendor/supabase-js.js', { method: 'HEAD', cache: 'no-store' })
      .then(function (r) { if (r && r.ok) { clearInterval(timer); location.reload(); } })
      .catch(function () {});
    if (++tries > 40) clearInterval(timer); // ~2 min then give it a rest
  }, 3000);
  window.addEventListener('online', function () { location.reload(); });
})();
