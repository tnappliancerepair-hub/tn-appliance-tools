// ant-theme.js — shared dark/light toggle for the office + tech boards.
// Drop <script src="/ant-theme.js"></script> in <head> (synchronous, so the
// theme applies before paint — no flash). Each page declares its DEFAULT look
// via <html data-default-theme="light"> (or "dark"); the toggle is OPT-IN and
// remembered per device in localStorage, so nothing changes for anyone until
// they choose. (2026-07-02, requested by office + techs.)
//
// 2026-07-04: added a shared PALETTE-REMAP layer so the toggle actually flips
// the ~40 pages that paint through CSS variables (var(--bg)/var(--ink)/…) even
// though they never hand-wrote [data-theme] rules. The remap keys on
// :root[data-theme="…"] (specificity 0,2,0) so it beats a page's bare :root
// default but uses the EXACT same values office-board/tech-job already ship —
// so the three hand-tuned pages are unaffected. Pages that hardcode their
// body colors don't have variables to flip; those keep their designed look
// (the toggle is a no-op there) and get real per-page rules separately.
(function () {
  var KEY = 'tn_theme';
  var root = document.documentElement;
  function saved() { try { return localStorage.getItem(KEY); } catch (_) { return null; } }
  var pageDefault = (root.getAttribute('data-default-theme') || 'light').toLowerCase();
  // saved choice wins; otherwise the page's declared default (no surprise flips).
  var initial = saved() || pageDefault;
  root.setAttribute('data-theme', initial);

  // --- Shared palette-remap (injected first so page-specific rules can win) ---
  // Covers every alias the internal pages use for the same role, so one choice
  // flips background, cards, text, lines and accents together (no dark-on-dark).
  var DARK = {
    bg: '#0e1118', paper: '#0e1118', surface: '#161b26', card: '#161b26', panel: '#161b26', panel2: '#1a2130',
    ink: '#e7edf5', text: '#e7edf5', fg: '#e7edf5', heading: '#e7edf5',
    ink2: '#9aa6b8', muted: '#9aa6b8', dim: '#6f7d94', sub: '#9aa6b8',
    line: '#28303e', border: '#28303e', 'border-strong': '#3a4354',
    blue: '#4d8bff', accent: '#4d8bff', 'accent-soft': '#182437', link: '#7fb0ff',
    ok: '#4bb57f', good: '#4bb57f', green: '#4bb57f',
    warn: '#e0a33f', warning: '#e0a33f', amber: '#e0a33f',
    bad: '#e8695a', crit: '#e8695a', danger: '#e8695a', red: '#e8695a',
    violet: '#8a72f0', shadow: '0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.28)'
  };
  var LIGHT = {
    bg: '#eef1f5', paper: '#f7f9fc', surface: '#ffffff', card: '#ffffff', panel: '#ffffff', panel2: '#f4f6f9',
    ink: '#1d2530', text: '#1d2530', fg: '#1d2530', heading: '#1d2530',
    ink2: '#5b6573', muted: '#5b6573', dim: '#8a93a1', sub: '#5b6573',
    line: '#e4e8ee', border: '#e4e8ee', 'border-strong': '#d8dee7',
    blue: '#1f6fed', accent: '#1f6fed', 'accent-soft': '#e8f0fd', link: '#1559c9',
    ok: '#1faa6b', good: '#1faa6b', green: '#1faa6b',
    warn: '#e8821e', warning: '#e8821e', amber: '#e8821e',
    bad: '#e24d4d', crit: '#e24d4d', danger: '#e24d4d', red: '#e24d4d',
    violet: '#7a5cf0', shadow: '0 1px 2px rgba(30,26,15,.05),0 6px 20px rgba(30,26,15,.06)'
  };
  function decls(map) {
    var out = '';
    for (var k in map) { if (map.hasOwnProperty(k)) out += '--' + k + ':' + map[k] + ';'; }
    return out;
  }
  function injectRemap() {
    if (document.getElementById('tn-theme-remap')) return;
    // Pages that hand-tune their OWN dark/light CSS (office-board, tech-job,
    // tech-daily-dashboard) opt out entirely.
    if (root.hasAttribute('data-self-theme')) return;
    // Only remap the theme OPPOSITE the page's default. On first load the page
    // shows its default theme, driven by its OWN :root — byte-identical to today,
    // nothing changes. The shared palette only applies to the theme a person
    // actively switches TO (the opposite one), so the flip is clean but the
    // untouched look is preserved until they tap. :not([data-self-theme]) keeps
    // the selector inert on the opted-out pages too.
    var css = pageDefault === 'dark'
      ? ':root:not([data-self-theme])[data-theme="light"]{' + decls(LIGHT) + '}'
      : ':root:not([data-self-theme])[data-theme="dark"]{' + decls(DARK) + '}';
    var st = document.createElement('style');
    st.id = 'tn-theme-remap';
    st.textContent = css;
    var head = document.head || document.getElementsByTagName('head')[0];
    if (head) head.insertBefore(st, head.firstChild); else document.documentElement.appendChild(st);
  }
  injectRemap();

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
    // floating bottom-LEFT (bottom-right is the Ask-Ant FAB), clears the
    // ant-shell bottom tabs (~84px)
    btn.style.cssText = 'position:fixed;z-index:2147483000;left:14px;'
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
