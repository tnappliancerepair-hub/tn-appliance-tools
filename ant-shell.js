// Ant App Shell — the single persistent navigation bar that makes every
// operational page feel like ONE app (the way Housecall Pro does). This is
// the per-APP nav; ant-spine.js is the per-JOB nav. They coexist.
//
// Renders a fixed bottom tab bar (HCP-mobile style — works identically on a
// phone and a desktop, never collides with existing page layout or the spine
// strip) plus a "More" sheet for secondary destinations. Role-aware: office
// staff see office tabs, techs see tech tabs.
//
// Drop into any operational page with:
//   <script src="/ant-shell.js" defer></script>
//
// Opt out on a page with: window.ANT_SHELL = false (before this loads).
// Force a role with: window.ANT_ROLE = 'tech' | 'office' (before this loads).

(function (root) {
  'use strict';

  var doc = root.document;

  // ── Role detection ───────────────────────────────────────────────
  // Reuse ant-spine's detector when present; otherwise replicate the
  // path heuristic so load order doesn't matter.
  function detectRole() {
    if (root.Ant && typeof root.Ant.role === 'function') {
      try { return root.Ant.role(); } catch (_) {}
    }
    if (root.ANT_ROLE) return root.ANT_ROLE;
    var path = (root.location.pathname || '').toLowerCase();
    if (path.indexOf('tech-') === 0 || path.indexOf('/tech-') !== -1) return 'tech';
    return 'office';
  }

  // ── Nav configs ──────────────────────────────────────────────────
  // page: the html file this tab points to. matches: extra pathnames that
  // should also light up this tab (so related pages still show "you are here").
  var OFFICE_TABS = [
    { id: 'home',     label: 'Home',     icon: '🏠', page: 'office.html',           matches: ['dashboard.html', 'office-pulse.html', 'office-today.html', 'office-todo.html'] },
    { id: 'schedule', label: 'Schedule', icon: '📅', page: 'office-calendar.html',  matches: ['office-schedule.html', 'office-kanban.html'] },
    { id: 'jobs',     label: 'Jobs',     icon: '🗂️', page: 'office-dashboard.html', matches: ['job-detail.html', 'office-tn.html', 'office-la.html'] },
    { id: 'queue',    label: 'Queue',    icon: '📥', page: 'needs-scheduled.html',  matches: ['needs-scheduling.html'] },
    { id: 'more',     label: 'More',     icon: '☰',       sheet: 'office' }
  ];

  var TECH_TABS = [
    { id: 'myday', label: 'My Day', icon: '📅', page: 'tech-daily-dashboard.html', matches: ['tech-ant-chat.html', 'tech-ant-live.html', 'tech-simple.html', 'tech-dashboard.html'] },
    { id: 'pay',   label: 'Pay',    icon: '💵', page: 'tech-payouts.html',         matches: [] },
    { id: 'stats', label: 'Stats',  icon: '📊', page: 'tech-performance.html',     matches: ['tech-leaderboard.html'] },
    { id: 'more',  label: 'More',   icon: '☰',       sheet: 'tech' }
  ];

  // Secondary destinations shown in the "More" sheet, per role.
  var MORE_SHEETS = {
    office: [
      { label: 'Customers',      icon: '👥', page: 'customer-search.html' },
      { label: 'Warranty',       icon: '📦', page: 'warranty-review.html' },
      { label: 'Money',          icon: '💰', page: 'financial-dashboard.html' },
      { label: 'Needs Action',   icon: '✅',       page: 'office-todo.html' },
      { label: 'Live Pulse',     icon: '🟢', page: 'office-pulse.html' },
      { label: 'Dispatch TV',    icon: '📺', page: 'dispatch-tv.html' },
      { label: 'Ask Ant',        icon: '🔍', page: 'ask-ant.html' }
    ],
    tech: [
      { label: 'Day Off',        icon: '🏖️', page: 'tech-day-off.html' },
      { label: 'Leaderboard',    icon: '🏆', page: 'tech-leaderboard.html' },
      { label: 'My Stats',       icon: '📊', page: 'tech-performance.html' }
    ]
  };

  function currentFile() {
    var p = (root.location.pathname || '').toLowerCase().replace(/^\/+/, '');
    if (p === '' || p.charAt(p.length - 1) === '/') p += 'index.html';
    return p.split('/').pop();
  }

  function isActive(tab, file) {
    if (tab.page && tab.page.toLowerCase() === file) return true;
    if (tab.matches) {
      for (var i = 0; i < tab.matches.length; i++) {
        if (tab.matches[i].toLowerCase() === file) return true;
      }
    }
    return false;
  }

  // Preserve job_id across nav when it makes sense (job-detail etc. carry it;
  // list pages don't need it but it's harmless). We DON'T forward it — list
  // destinations should land clean. Only the More sheet preserves nothing.

  // ── Styles ───────────────────────────────────────────────────────
  var ACCENT = '#74e3c4';
  var DIM = '#8a93a3';

  function injectStyles() {
    if (doc.getElementById('ant-shell-style')) return;
    var css = ''
      + '#ant-shell-bar{position:fixed;left:0;right:0;bottom:0;z-index:99990;'
      + 'display:flex;background:rgba(10,12,17,0.96);backdrop-filter:blur(12px);'
      + '-webkit-backdrop-filter:blur(12px);border-top:1px solid rgba(255,255,255,0.08);'
      + 'padding-bottom:env(safe-area-inset-bottom,0px);box-shadow:0 -2px 14px rgba(0,0,0,0.3);'
      + 'font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;}'
      + '#ant-shell-bar a,#ant-shell-bar button{flex:1;display:flex;flex-direction:column;'
      + 'align-items:center;justify-content:center;gap:2px;padding:7px 2px 6px;'
      + 'background:none;border:none;cursor:pointer;text-decoration:none;color:' + DIM + ';'
      + 'font-size:10px;font-weight:600;letter-spacing:0.2px;line-height:1;'
      + 'transition:color .15s;-webkit-tap-highlight-color:transparent;min-width:0;}'
      + '#ant-shell-bar a:active,#ant-shell-bar button:active{opacity:0.6;}'
      + '#ant-shell-bar .ant-ic{font-size:20px;line-height:1;}'
      + '#ant-shell-bar .ant-active{color:' + ACCENT + ';}'
      + '#ant-shell-bar .ant-active .ant-ic{filter:drop-shadow(0 0 6px rgba(116,227,196,0.5));}'
      + '#ant-shell-spacer{height:calc(58px + env(safe-area-inset-bottom,0px));}'
      + '#ant-shell-scrim{position:fixed;inset:0;z-index:99991;background:rgba(0,0,0,0.5);'
      + 'opacity:0;pointer-events:none;transition:opacity .2s;}'
      + '#ant-shell-scrim.open{opacity:1;pointer-events:auto;}'
      + '#ant-shell-sheet{position:fixed;left:0;right:0;bottom:0;z-index:99992;'
      + 'background:#11141b;border-top-left-radius:18px;border-top-right-radius:18px;'
      + 'border-top:1px solid rgba(255,255,255,0.1);padding:10px 14px calc(20px + env(safe-area-inset-bottom,0px));'
      + 'transform:translateY(110%);transition:transform .24s cubic-bezier(.2,.8,.2,1);'
      + 'font-family:-apple-system,system-ui,sans-serif;}'
      + '#ant-shell-sheet.open{transform:translateY(0);}'
      + '#ant-shell-sheet .ant-grip{width:38px;height:4px;border-radius:3px;background:rgba(255,255,255,0.2);margin:4px auto 12px;}'
      + '#ant-shell-sheet .ant-sheet-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}'
      + '#ant-shell-sheet .ant-sheet-grid a{display:flex;flex-direction:column;align-items:center;gap:6px;'
      + 'padding:14px 6px;border-radius:13px;background:rgba(255,255,255,0.04);'
      + 'border:1px solid rgba(255,255,255,0.07);text-decoration:none;color:#dce2ec;'
      + 'font-size:11px;font-weight:600;text-align:center;}'
      + '#ant-shell-sheet .ant-sheet-grid a:active{background:rgba(116,227,196,0.12);}'
      + '#ant-shell-sheet .ant-sheet-grid .ant-ic{font-size:23px;}'
      + '#ant-shell-sheet .ant-sheet-title{color:' + DIM + ';font-size:11px;font-weight:700;'
      + 'text-transform:uppercase;letter-spacing:1px;margin:2px 2px 10px;}'
      + '@media(min-width:780px){#ant-shell-bar{max-width:560px;left:50%;transform:translateX(-50%);'
      + 'bottom:14px;border-radius:16px;border:1px solid rgba(255,255,255,0.1);}'
      + '#ant-shell-sheet{max-width:520px;left:50%;transform:translateX(-50%) translateY(110%);'
      + 'border-radius:18px;bottom:14px;}'
      + '#ant-shell-sheet.open{transform:translateX(-50%) translateY(0);}}';
    var s = doc.createElement('style');
    s.id = 'ant-shell-style';
    s.textContent = css;
    doc.head.appendChild(s);
  }

  // ── Sheet (More) ─────────────────────────────────────────────────
  function buildSheet(role) {
    var items = MORE_SHEETS[role] || MORE_SHEETS.office;
    var grid = items.map(function (it) {
      return '<a href="/' + it.page + '"><span class="ant-ic">' + it.icon + '</span>' + it.label + '</a>';
    }).join('');
    var scrim = doc.createElement('div');
    scrim.id = 'ant-shell-scrim';
    var sheet = doc.createElement('div');
    sheet.id = 'ant-shell-sheet';
    sheet.innerHTML = '<div class="ant-grip"></div>'
      + '<div class="ant-sheet-title">' + (role === 'tech' ? 'Tech menu' : 'Office menu') + '</div>'
      + '<div class="ant-sheet-grid">' + grid + '</div>';
    doc.body.appendChild(scrim);
    doc.body.appendChild(sheet);
    function close() { scrim.classList.remove('open'); sheet.classList.remove('open'); }
    scrim.addEventListener('click', close);
    root.__antShellCloseSheet = close;
    root.__antShellOpenSheet = function () { scrim.classList.add('open'); sheet.classList.add('open'); };
  }

  // ── Bottom bar ───────────────────────────────────────────────────
  function buildBar(role) {
    var tabs = role === 'tech' ? TECH_TABS : OFFICE_TABS;
    var file = currentFile();
    var bar = doc.createElement('nav');
    bar.id = 'ant-shell-bar';
    bar.setAttribute('aria-label', 'Ant navigation');
    var html = tabs.map(function (t) {
      var active = t.page ? isActive(t, file) : false;
      var cls = 'ant-ic';
      var wrapCls = active ? 'ant-active' : '';
      var inner = '<span class="' + cls + '">' + t.icon + '</span><span>' + t.label + '</span>';
      if (t.sheet) {
        return '<button type="button" class="' + wrapCls + '" data-ant-sheet="1">' + inner + '</button>';
      }
      return '<a class="' + wrapCls + '" href="/' + t.page + '">' + inner + '</a>';
    }).join('');
    bar.innerHTML = html;
    doc.body.appendChild(bar);
    // Spacer so fixed bar never covers page content / footers.
    var spacer = doc.createElement('div');
    spacer.id = 'ant-shell-spacer';
    doc.body.appendChild(spacer);
    var sheetBtn = bar.querySelector('[data-ant-sheet]');
    if (sheetBtn) {
      sheetBtn.addEventListener('click', function () {
        if (root.__antShellOpenSheet) root.__antShellOpenSheet();
      });
    }
  }

  // ── Coexist with the per-job spine strip ─────────────────────────
  // The spine strip is a TOP bar; our shell is a BOTTOM bar — no collision.
  // Nothing to reconcile, but expose a version flag for debugging.

  function init() {
    if (root.ANT_SHELL === false) return;
    if (!doc.body) return;
    if (doc.getElementById('ant-shell-bar')) return;
    var role = detectRole();
    injectStyles();
    buildSheet(role);
    buildBar(role);
    root.Ant = root.Ant || {};
    root.Ant.shellVersion = '1.0.0';
    root.Ant.shellRole = role;
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
