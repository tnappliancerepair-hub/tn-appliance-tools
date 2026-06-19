// Shared top nav for every office page. Self-injects a sticky pill row
// at the top of the body. Each pill links to a page; the current page
// is highlighted. Include once per page:
//   <script src="/office-nav.js?v=20260601-1"></script>
//
// Office surfaces aim for ONE simple navigation row so Teddy or Danielle
// never have to remember a URL. Match the office-today/office-dashboard
// pill aesthetic (rounded chip, color-coded, mobile-scrollable).
(function () {
  if (window.__OFFICE_NAV_LOADED__) return;
  window.__OFFICE_NAV_LOADED__ = true;

  // Caveman simple: 4 pills. Everything else is reachable from links
  // inside these pages (warranty review from Today's warranty section,
  // payouts/leaderboard/feedback/loop-health from inside All Jobs, etc.).
  const NAV = [
    { id: 'today',     label: '🐜 Today',    href: '/office-today.html',     color: '#b48cff' },
    { id: 'messages',  label: '💬 Messages', href: '/office-messages.html',  color: '#5aa9ff' },
    { id: 'calendar',  label: '📅 Calendar', href: '/office-calendar.html',  color: '#4a9eff' },
    { id: 'search',    label: '🔍 Search',   href: '/customer-search.html',  color: '#74e3c4' },
    { id: 'dispatch',  label: '📞 Ant Call', href: '/voice-dispatch.html',   color: '#4ad991' },
    { id: 'templates', label: '💬 Texts',    href: '/office-templates.html',  color: '#ffb86b' },
    { id: 'calls',     label: '📞 Calls',    href: '/recent-calls.html',     color: '#4ca7ff' },
    { id: 'vacation',  label: '🏖 Status',   href: '/vacation-status.html',  color: '#ff8cbc' },
    { id: 'dashboard', label: '📊 All Jobs', href: '/office-dashboard.html', color: '#f5a623' },
    { id: 'parts',     label: '📦 Parts $',  href: '/parts-ledger.html',     color: '#5aa9ff' },
  ];

  function currentPath() {
    return (location.pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  }

  function isActive(pill) {
    const p = currentPath();
    const target = pill.href.toLowerCase().replace(/\/+$/, '');
    if (p === target) return true;
    // Match office.html → office-today.html (since office.html redirects)
    if (p === '/office.html' && pill.id === 'today') return true;
    return false;
  }

  function render() {
    // ant-spine.js renders a fixed deep-link strip at top:0, z:9999.
    // When both navs are on the same page (job-detail, teddy-tdr-tool,
    // warranty-review), the pill nav collides UNDER the spine strip
    // and its labels get clipped. Detect spine and offset accordingly.
    const hasSpine = !!document.querySelector('script[src*="ant-spine.js"]');
    const TOP_OFFSET = hasSpine ? '38px' : '0';

    // Horizontal-scroll pill row. Each pill sizes to its content; the bar
    // scrolls left-right so on a narrow phone Teddy can swipe through all
    // pills instead of having labels crushed into circles by `flex:1`.
    const bar = document.createElement('div');
    bar.id = 'office-topnav';
    bar.style.cssText = [
      'position:sticky', `top:${TOP_OFFSET}`, 'z-index:9000',
      'display:flex', 'gap:8px', 'padding:10px 14px',
      'overflow-x:auto', 'overflow-y:hidden',
      '-webkit-overflow-scrolling:touch',
      'background:#131720', 'border-bottom:1px solid #2a3040',
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    ].join(';');

    bar.innerHTML = NAV.map(p => {
      const active = isActive(p);
      const bg = active ? p.color : (p.color + '22');
      const border = active ? p.color : (p.color + '88');
      const fg = active ? '#0e1118' : p.color;
      const size = active ? '15px' : '14px';
      const padding = active ? '10px 18px' : '10px 16px';
      const weight = active ? '900' : '700';
      // No flex:1 — pills size to their content. flex-shrink:0 prevents
      // the row from squashing them when total content exceeds viewport.
      // Bar scrolls horizontally instead.
      return `<a href="${p.href}" style="background:${bg}; border:2px solid ${border}; color:${fg}; padding:${padding}; border-radius:22px; font-size:${size}; font-weight:${weight}; text-decoration:none; white-space:nowrap; flex-shrink:0; text-align:center; transition:transform 0.05s">${p.label}</a>`;
    }).join('');

    // Inject style for tap feedback
    if (!document.getElementById('office-topnav-style')) {
      const s = document.createElement('style');
      s.id = 'office-topnav-style';
      s.textContent = `
        #office-topnav::-webkit-scrollbar { display: none; }
        #office-topnav a:active { transform: scale(0.96); }
      `;
      document.head.appendChild(s);
    }

    document.body.insertBefore(bar, document.body.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
