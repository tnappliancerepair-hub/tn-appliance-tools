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

  const NAV = [
    { id: 'today',      label: '🐜 Today',           href: '/office-today.html',       color: '#b48cff' },
    { id: 'needs',      label: '🗓 Needs Scheduled', href: '/needs-scheduled.html',    color: '#4a9eff' },
    { id: 'calendar',   label: '📅 Calendar',        href: '/office-calendar.html',    color: '#4a9eff' },
    { id: 'dashboard',  label: '📊 All Jobs',        href: '/office-dashboard.html',   color: '#4a9eff' },
    { id: 'warranty',   label: '📋 Warranty Review', href: '/warranty-review.html',    color: '#f5a623' },
    { id: 'payouts',    label: '💵 Payouts',         href: '/tech-payouts.html',       color: '#74e3c4' },
    { id: 'feedback',   label: '⭐ Feedback',        href: '/customer-feedback.html',  color: '#f5a623' },
    { id: 'leaderboard',label: '🏆 Leaderboard',     href: '/tech-leaderboard.html',   color: '#74e3c4' },
    { id: 'search',     label: '🔍 Search',          href: '/customer-search.html',    color: '#8a93aa' },
    { id: 'health',     label: '🩺 Loop Health',     href: '/health-check.html',       color: '#8a93aa' },
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
    const bar = document.createElement('div');
    bar.id = 'office-topnav';
    bar.style.cssText = [
      'position:sticky', 'top:0', 'z-index:9000',
      'display:flex', 'gap:6px', 'padding:8px 12px',
      'overflow-x:auto', 'overflow-y:hidden',
      'background:#131720', 'border-bottom:1px solid #2a3040',
      '-webkit-overflow-scrolling:touch',
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    ].join(';');

    bar.innerHTML = NAV.map(p => {
      const active = isActive(p);
      const bg = active ? p.color : (p.color + '22');
      const border = active ? p.color : (p.color + '66');
      const fg = active ? '#0e1118' : p.color;
      return `<a href="${p.href}" style="background:${bg}; border:1px solid ${border}; color:${fg}; padding:7px 13px; border-radius:18px; font-size:12px; font-weight:700; text-decoration:none; white-space:nowrap; flex-shrink:0; transition:transform 0.05s">${p.label}</a>`;
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
