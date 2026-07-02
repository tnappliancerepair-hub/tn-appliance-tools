// ant-theme.js — shared dark/light toggle for the office + tech boards.
// Drop <script src="/ant-theme.js"></script> in <head> (synchronous, so the
// theme applies before paint — no flash). Each page declares its DEFAULT look
// via <html data-default-theme="light"> (or "dark"); the toggle is OPT-IN and
// remembered per device in localStorage, so nothing changes for anyone until
// they choose. Pages provide the matching [data-theme="dark"] / [data-theme=
// "light"] CSS overrides. (2026-07-02, requested by office + techs.)
(function () {
  var KEY = 'tn_theme';
  var root = document.documentElement;
  function saved() { try { return localStorage.getItem(KEY); } catch (_) { return null; } }
  var pageDefault = (root.getAttribute('data-default-theme') || 'light').toLowerCase();
  // saved choice wins; otherwise the page's declared default (no surprise flips).
  var initial = saved() || pageDefault;
  root.setAttribute('data-theme', initial);

  var btn = null;
  function isDark() { return root.getAttribute('data-theme') === 'dark'; }
  function paint() {
    if (!btn) return;
    btn.textContent = isDark() ? '☀️' : '🌙';
    btn.title = isDark() ? 'Switch to light mode' : 'Switch to dark mode';
    btn.setAttribute('aria-pressed', String(isDark()));
  }
  function toggle() {
    var next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch (_) {}
    paint();
  }
  function mount() {
    if (document.getElementById('tn-theme-toggle')) return;
    btn = document.createElement('button');
    btn.id = 'tn-theme-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle dark or light mode');
    btn.onclick = toggle;
    // floating, clears the bottom nav (ant-shell tabs ~84px)
    btn.style.cssText = 'position:fixed;z-index:2147483000;right:14px;'
      + 'bottom:calc(96px + env(safe-area-inset-bottom,0px));width:44px;height:44px;'
      + 'border-radius:50%;border:1px solid rgba(128,140,160,.4);'
      + 'background:rgba(127,134,150,.22);-webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px);'
      + 'font-size:20px;line-height:1;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.28);'
      + 'display:flex;align-items:center;justify-content:center;padding:0;';
    document.body.appendChild(btn);
    paint();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
