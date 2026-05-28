// Persistent "🏠 Home" button on every office page. Floating bottom-left
// so it doesn't conflict with the bottom-right Ask Ant 🐜 widget.
// Tap → go to /office.html (the central hub). Hidden on /office.html
// itself since you're already there.
//
// Per Danielle 2026-05-28: "need a home button for main dashboard."
(function () {
  'use strict';
  if (window.__officeHomeInjected) return;
  window.__officeHomeInjected = true;

  // Skip if already on the hub
  const path = (location.pathname || '').toLowerCase();
  if (path === '/office.html' || path === '/office' || path === '/') return;

  function inject() {
    if (document.getElementById('office-home-btn')) return;
    const btn = document.createElement('a');
    btn.id = 'office-home-btn';
    btn.href = '/office.html';
    btn.title = 'Office home';
    btn.innerHTML = '🏠';
    btn.style.cssText = `
      position: fixed; bottom: 22px; left: 22px;
      width: 52px; height: 52px; border-radius: 50%;
      background: rgba(30,33,42,0.92); color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; text-decoration: none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 9400;
      transition: transform 0.15s ease;
      border: 1px solid rgba(255,255,255,0.1);
    `;
    btn.onmouseenter = () => { btn.style.transform = 'scale(1.08)'; };
    btn.onmouseleave = () => { btn.style.transform = 'scale(1)'; };
    document.body.appendChild(btn);
  }
  if (document.body) inject();
  else document.addEventListener('DOMContentLoaded', inject);
})();
