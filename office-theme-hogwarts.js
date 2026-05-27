// Hogwarts theme overlay for the office portal. Self-injecting style +
// micro-decoration. Doesn't touch layout, data, or any existing logic —
// just paints over the surface. Toggle off by removing the <script> tag.
(function () {
  'use strict';
  if (window.__hogwartsTheme) return;
  window.__hogwartsTheme = true;

  // Load Cinzel (serif, vaguely "wizarding") from Google Fonts
  const font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Cormorant+Garamond:ital,wght@0,400;0,700;1,400&display=swap';
  document.head.appendChild(font);

  const css = `
    /* ── Parchment ───────────────────────────────────────────────── */
    body {
      background:
        radial-gradient(ellipse at top, rgba(108,80,40,0.10), transparent 60%),
        radial-gradient(ellipse at bottom, rgba(76,40,28,0.08), transparent 60%),
        #f4e8d0 !important;
      color: #2c1810 !important;
      font-family: 'Cormorant Garamond', Georgia, serif !important;
    }

    /* Subtle parchment grain via repeating gradient */
    body::before {
      content: '';
      position: fixed; inset: 0;
      background:
        repeating-linear-gradient(0deg, rgba(120,80,40,0.02) 0px, transparent 2px, transparent 4px),
        repeating-linear-gradient(90deg, rgba(120,80,40,0.02) 0px, transparent 3px, transparent 6px);
      pointer-events: none;
      z-index: 1;
    }

    /* Cards = aged parchment */
    .folder, .sub, .job-card, .row, .modal-card, .auth-card, .ofc-search-results {
      background: linear-gradient(135deg, #fdf6e3, #f4e8d0) !important;
      border: 1px solid #c4a572 !important;
      color: #2c1810 !important;
      box-shadow: 0 2px 8px rgba(76,40,28,0.10), inset 0 0 0 1px rgba(255,255,255,0.5) !important;
    }

    /* Headers + titles → Cinzel for that "carved in stone" feel */
    .folder-header, .sub-header, .header .title, .topbar h1,
    .auth-card h2, .modal-card h2, .row .who {
      font-family: 'Cinzel', Georgia, serif !important;
      color: #4a1c1c !important;
      letter-spacing: 0.04em !important;
    }

    /* Search bar — dark mahogany frame */
    .ofc-search-bar {
      background: linear-gradient(135deg, #3d1e0f, #5c2e1a) !important;
      border-bottom: 2px solid #c4a572 !important;
      box-shadow: 0 2px 12px rgba(0,0,0,0.25) !important;
    }
    .ofc-search-input {
      background: rgba(244,232,208,0.92) !important;
      color: #2c1810 !important;
      border: 1px solid #8b6914 !important;
      font-family: 'Cormorant Garamond', Georgia, serif !important;
    }
    .ofc-search-input::placeholder { color: #6b4423 !important; }

    /* Region toggle — Gryffindor gold + maroon */
    .ofc-region-toggle a {
      font-family: 'Cinzel', Georgia, serif !important;
    }
    .ofc-region-toggle a[style*="background:#fff"] {
      background: linear-gradient(135deg, #d4af37, #b8860b) !important;
      color: #2c1810 !important;
    }

    /* Map button → "Marauder's Map" */
    .ofc-map-btn {
      background: linear-gradient(135deg, #722f37, #4a1c1c) !important;
      color: #d4af37 !important;
      border: 1px solid #d4af37 !important;
      font-family: 'Cinzel', Georgia, serif !important;
      letter-spacing: 0.05em !important;
    }
    .ofc-map-btn::before { content: '✦ '; }

    /* Topbar (needs-scheduled) → dark wood */
    .topbar {
      background: linear-gradient(135deg, #3d1e0f, #5c2e1a) !important;
      color: #f4e8d0 !important;
      border-bottom: 2px solid #c4a572 !important;
    }
    .topbar h1, .topbar h1 * { color: #d4af37 !important; }
    .topbar .count { background: #d4af37 !important; color: #2c1810 !important; }

    /* Buttons → wax-seal style */
    .row .actions .schedule, .modal-actions .submit, .auth-card button {
      background: linear-gradient(135deg, #722f37, #4a1c1c) !important;
      color: #d4af37 !important;
      border: 1px solid #d4af37 !important;
      font-family: 'Cinzel', Georgia, serif !important;
      text-transform: none !important;
      letter-spacing: 0.04em !important;
    }
    .topbar button.add-manual {
      background: linear-gradient(135deg, #d4af37, #b8860b) !important;
      color: #2c1810 !important;
    }
    .topbar button.refresh {
      background: rgba(244,232,208,0.15) !important;
      border-color: #d4af37 !important;
      color: #f4e8d0 !important;
    }

    /* Job meta + body text */
    .job-customer, .row .who { color: #2c1810 !important; font-weight: 700; }
    .job-meta, .job-meta-small, .row .what, .row .addr,
    .folder-count, .sub-count, .row .age {
      color: #6b4423 !important;
      font-family: 'Cormorant Garamond', Georgia, serif !important;
      font-style: italic;
    }
    .job-id { color: #4a1c1c !important; font-family: 'Cinzel', monospace !important; }
    .job-problem {
      background: rgba(244,232,208,0.6) !important;
      border-left: 3px solid #8b6914 !important;
      color: #4a1c1c !important;
      font-style: italic;
    }

    /* Badges → House colors */
    .row .badge { background: rgba(212,175,55,0.18) !important; color: #4a1c1c !important; font-family: 'Cinzel', monospace !important; }
    .row .badge.warranty { background: rgba(114,47,55,0.18) !important; color: #722f37 !important; }
    .row .badge.source { background: rgba(139,105,20,0.20) !important; color: #5c3a0a !important; }

    /* Stage selects → parchment dropdown */
    .stage-select, .modal-card input, .modal-card select, .modal-card textarea {
      background: #fdf6e3 !important;
      color: #2c1810 !important;
      border: 1px solid #8b6914 !important;
      font-family: 'Cormorant Garamond', Georgia, serif !important;
    }

    /* Hover states — gold shimmer */
    .folder-header:hover, .sub-header:hover, .ofc-search-row:hover {
      background: rgba(212,175,55,0.10) !important;
    }

    /* Auth screen — full Hogwarts gate */
    .auth-overlay, .auth-gate {
      background:
        radial-gradient(ellipse at top, rgba(212,175,55,0.10), transparent 70%),
        linear-gradient(180deg, #1a0a05, #2c1810) !important;
    }
    .auth-card {
      background: linear-gradient(135deg, #fdf6e3, #e8d8b0) !important;
      border: 2px solid #d4af37 !important;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(212,175,55,0.4) !important;
    }
    .auth-card h2::before { content: '🦉 '; }
    .auth-card input { background: #fdf6e3 !important; border-color: #8b6914 !important; color: #2c1810 !important; }

    /* Map modal flair */
    #ofcMapModal > div > div:first-child {
      background: linear-gradient(135deg, #3d1e0f, #722f37) !important;
      border-bottom: 2px solid #d4af37 !important;
    }
    #ofcMapModal > div > div:first-child span:first-child::before { content: '✦ '; color: #d4af37; }

    /* Refresh + chevrons in gold */
    .chevron { color: #8b6914 !important; }
    .header .refresh-btn { color: #d4af37 !important; border-color: #d4af37 !important; }
    .header { background: linear-gradient(135deg, #1a0a05, #3d1e0f) !important; border-bottom: 2px solid #d4af37 !important; }
    .header .title { color: #d4af37 !important; }
    .header .sub { color: #c4a572 !important; }

    /* Toast — black ink quill */
    .toast { background: #2c1810 !important; color: #d4af37 !important; border: 1px solid #d4af37 !important; font-family: 'Cinzel', serif !important; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // Add a small "🦉" owl mark next to the ant emoji in the brand spot
  function addOwlMark() {
    const ants = document.querySelectorAll('.icon, .brand .ant');
    ants.forEach(a => {
      if (a.dataset.owled) return;
      a.dataset.owled = '1';
      const wand = document.createElement('span');
      wand.textContent = ' ✦';
      wand.style.cssText = 'color:#d4af37;font-size:0.6em;vertical-align:super;';
      a.appendChild(wand);
    });
  }
  if (document.body) addOwlMark();
  else document.addEventListener('DOMContentLoaded', addOwlMark);
  setTimeout(addOwlMark, 500);
})();
