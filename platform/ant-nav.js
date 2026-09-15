// ant-nav.js — the shared APP SHELL for the platform tech surfaces: a bottom tab bar
// (My Day · Pay · Stats · More) + an optional floating progress pill. Drop
// <script src="/platform/ant-nav.js"></script> before </body> on any tech page and it
// injects itself. Pages opt into the pill by setting window.antProg = {icon,label,pct,href}
// and calling window.antProgUpdate(). This is the "it's a real app" layer.
(function () {
  if (document.querySelector('.tabbar')) return;
  var path = location.pathname, hash = location.hash;
  var isDay = /\/tech\.html$/.test(path);

  function tab(href, ic, label, on) {
    return '<a class="tab' + (on ? ' on' : '') + '" href="' + href + '">' +
      '<span class="ic">' + ic + '</span>' + label + '</a>';
  }
  var bar = document.createElement('nav');
  bar.className = 'tabbar';
  bar.setAttribute('aria-label', 'Tech navigation');
  bar.innerHTML =
    tab('/platform/tech.html', '📅', 'My Day', isDay && (!hash || hash === '#day')) +
    tab('/platform/tech.html#pay', '💰', 'Pay', isDay && hash === '#pay') +
    tab('/platform/tech.html#stats', '📊', 'Stats', isDay && hash === '#stats') +
    tab('/platform/tech.html#more', '☰', 'More', isDay && hash === '#more');
  document.body.appendChild(bar);
  document.body.classList.add('has-tabbar');

  // Floating progress pill — opt-in. Set window.antProg then call antProgUpdate().
  function renderPill() {
    var p = window.antProg;
    var el = document.getElementById('antProgPill');
    if (!p) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('a');
      el.id = 'antProgPill';
      el.className = 'progpill';
      document.body.appendChild(el);
    }
    el.href = p.href || 'javascript:void(0)';
    var pct = (p.pct == null) ? '' : '<span class="pct">' + p.pct + '%</span>';
    el.innerHTML = (p.icon || '📋') + ' ' + (p.label || 'Report') + ' ' + pct;
  }
  window.antProgUpdate = renderPill;
  renderPill();

  // On the day view, a tab tap to a hash scrolls to that section (if present).
  if (isDay) {
    window.addEventListener('hashchange', function () {
      var id = (location.hash || '').replace('#', '');
      var t = id && (document.getElementById(id) || document.getElementById(id + 'Card'));
      if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // re-highlight active tab
      var tabs = document.querySelectorAll('.tabbar .tab');
      for (var i = 0; i < tabs.length; i++) {
        var href = tabs[i].getAttribute('href') || '';
        tabs[i].classList.toggle('on', href.indexOf('#' + id) >= 0 || (!location.hash && /tech\.html$/.test(href)));
      }
    });
  }
})();
