// theme-toggle — the night/day switch (Teddy: some techs can't see dark, some can't see light).
//
// Every platform page defines TWO palettes: the bare :root is the LIGHT theme (the office
// colors) and [data-theme="dark"] / @media(prefers-color-scheme:dark) is the DARK theme (the
// tech-app navy + purple/orange/green). This shim lets each device PIN a choice that survives
// reloads; with no choice it follows the phone's system setting.
//
// Load it in <head> (after the page's <style>) so the saved theme is stamped on <html> BEFORE
// the body paints — no flash. It drops a small ☀️/🌙 button bottom-left on every page.
(function () {
  'use strict';
  try {
    var KEY = 'ant_theme';                 // 'light' | 'dark'  (absent = follow the system)
    var root = document.documentElement;
    var saved = null; try { saved = localStorage.getItem(KEY); } catch (_) {}
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);  // pre-paint stamp

    function current() {
      var a = root.getAttribute('data-theme');
      if (a === 'light' || a === 'dark') return a;
      return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    var btn = null;
    function paint() {
      if (!btn) return;
      var dark = current() === 'dark';
      btn.textContent = dark ? '☀️' : '🌙';
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      btn.title = dark ? 'Light mode' : 'Dark mode';
    }
    function apply(t) {
      root.setAttribute('data-theme', t);
      try { localStorage.setItem(KEY, t); } catch (_) {}
      paint();
    }
    function mount() {
      if (document.getElementById('antThemeToggle')) return;
      btn = document.createElement('button');
      btn.id = 'antThemeToggle';
      btn.type = 'button';
      btn.style.cssText = 'position:fixed;left:14px;bottom:16px;z-index:70;width:44px;height:44px;border-radius:50%;border:1px solid rgba(128,140,170,.4);background:rgba(17,29,51,.6);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);color:#fff;font-size:20px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.35);display:grid;place-items:center;line-height:1;padding:0';
      btn.onclick = function () { apply(current() === 'dark' ? 'light' : 'dark'); };
      document.body.appendChild(btn);
      paint();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
  } catch (_) { /* never let the theme shim break a page */ }
})();
