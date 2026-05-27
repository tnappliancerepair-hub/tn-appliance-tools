// Per-tech theme overlay for Tech Field pages. Reads tech_id from URL
// (?tech_id=N) and paints a personalized visual world. Each tech feels
// like the app was built for them. Self-injecting; no layout/data/logic
// changes — pure surface paint.
//
// Theme map (active techs only):
//   1  Teddy  → owner / Hogwarts (matches office)
//   2  Jimmy  → custom truck (matte black + safety orange)
//   3  Andre  → classic cars (chrome + hot-rod red)
//   4  Lee    → Deadpool (red + black + comic flair)
//   5  Billy  → Cajun coast (placeholder — TBD)
//   6  John   → NASCAR (checkered + racing red/blue)
//
// To swap a tech's theme: edit THEMES[id].name + theme block below.
// To toggle off: remove the <script src="/tech-theme.js"> tag.
(function () {
  'use strict';
  if (window.__techTheme) return;
  window.__techTheme = true;

  // Pull tech_id from URL
  function getTechId() {
    const m = (location.search || '').match(/[?&]tech_id=(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }
  const techId = getTechId();
  if (!techId) return; // No tech_id → no theme

  // ── Font loader (idempotent per family) ──────────────────────────
  function loadFont(href) {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }

  // ── Theme definitions ────────────────────────────────────────────

  const THEMES = {
    // ── TEDDY (id 1) — Hogwarts (matches office overlay) ──
    1: {
      name: 'Hogwarts',
      tagline: 'Mischief managed.',
      mark: '🦉',
      accent: '#d4af37',
      fonts: ['https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Cormorant+Garamond:wght@400;700&display=swap'],
      css: `
        body {
          background:
            radial-gradient(ellipse at top, rgba(108,80,40,0.18), transparent 60%),
            linear-gradient(180deg, #1a0a05, #2c1810) !important;
          color: #f4e8d0 !important;
          font-family: 'Cormorant Garamond', Georgia, serif !important;
        }
        h1, h2, h3, .title, .header h1, .topbar h1, .nav-pill, .quick-action {
          font-family: 'Cinzel', Georgia, serif !important;
          letter-spacing: 0.05em !important;
          color: #d4af37 !important;
        }
        .job-card, .stat-card, .auth-card, .modal-card, .tdr-form, .chat-msg, .pill, .nav-pill {
          background: linear-gradient(135deg, #fdf6e3, #e8d8b0) !important;
          border: 1px solid #d4af37 !important;
          color: #2c1810 !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(212,175,55,0.4) !important;
        }
        button, .btn, .save-btn, .start-btn, .complete-btn, .submit, .schedule, .send-btn {
          background: linear-gradient(135deg, #722f37, #4a1c1c) !important;
          color: #d4af37 !important;
          border: 1px solid #d4af37 !important;
          font-family: 'Cinzel', serif !important;
          letter-spacing: 0.04em !important;
        }
        input, select, textarea {
          background: #fdf6e3 !important;
          color: #2c1810 !important;
          border: 1px solid #8b6914 !important;
          font-family: 'Cormorant Garamond', serif !important;
        }
        input:focus, select:focus, textarea:focus { border-color: #d4af37 !important; outline: none !important; }
        a { color: #d4af37 !important; }
        .header, .topbar { background: linear-gradient(135deg, #1a0a05, #3d1e0f) !important; border-bottom: 2px solid #d4af37 !important; }
      `,
    },

    // ── JIMMY (id 2) — Custom Truck: matte black + safety orange + diamond plate ──
    2: {
      name: 'Custom Truck',
      tagline: 'Built, not bought.',
      mark: '🛻',
      accent: '#ff7a1a',
      fonts: ['https://fonts.googleapis.com/css2?family=Black+Ops+One&family=Oxanium:wght@400;700&display=swap'],
      css: `
        body {
          background:
            linear-gradient(135deg, rgba(255,122,26,0.04), transparent 60%),
            repeating-linear-gradient(45deg, #1a1a1a 0px, #1a1a1a 12px, #1f1f1f 12px, #1f1f1f 24px) !important;
          color: #f0f0f0 !important;
          font-family: 'Oxanium', system-ui, sans-serif !important;
        }
        h1, h2, h3, .title, .header h1, .topbar h1, .stat-label, .nav-pill, .quick-action {
          font-family: 'Black Ops One', 'Oxanium', sans-serif !important;
          letter-spacing: 0.05em !important;
        }
        .job-card, .stat-card, .auth-card, .modal-card, .tdr-form, .chat-msg, .pill, .nav-pill {
          background: linear-gradient(180deg, #2a2a2a, #1c1c1c) !important;
          border: 1px solid #ff7a1a !important;
          border-radius: 6px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05) !important;
          color: #f0f0f0 !important;
        }
        button, .btn, .save-btn, .start-btn, .complete-btn, .submit, .schedule, .send-btn {
          background: linear-gradient(180deg, #ff8c2a, #d65f0c) !important;
          color: #1a1a1a !important;
          border: 1px solid #1a1a1a !important;
          font-family: 'Black Ops One', sans-serif !important;
          letter-spacing: 0.04em !important;
          text-transform: uppercase !important;
          box-shadow: 0 2px 0 #8a3d00, 0 3px 6px rgba(0,0,0,0.4) !important;
        }
        input, select, textarea {
          background: #0f0f0f !important;
          color: #f0f0f0 !important;
          border: 1px solid #555 !important;
          font-family: 'Oxanium', sans-serif !important;
        }
        input:focus, select:focus, textarea:focus { border-color: #ff7a1a !important; outline: none !important; }
        a { color: #ff7a1a !important; }
      `,
    },

    // ── ANDRE (id 3) — Classic Cars: chrome + cream + hot-rod red ──
    3: {
      name: 'Classic Cars',
      tagline: 'Keep it shiny.',
      mark: '🚗',
      accent: '#c8102e',
      fonts: ['https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Special+Elite&family=Cardo:wght@400;700&display=swap'],
      css: `
        body {
          background:
            radial-gradient(ellipse at top, rgba(200,16,46,0.06), transparent 60%),
            linear-gradient(180deg, #e8e8e8, #d0d0d0) !important;
          color: #1c1c1c !important;
          font-family: 'Cardo', Georgia, serif !important;
        }
        h1, h2, h3, .title, .header h1, .topbar h1, .stat-label, .nav-pill {
          font-family: 'Bebas Neue', sans-serif !important;
          letter-spacing: 0.08em !important;
          color: #c8102e !important;
        }
        .job-card, .stat-card, .auth-card, .modal-card, .tdr-form, .pill, .nav-pill {
          background: linear-gradient(180deg, #fafafa, #e8e8e8) !important;
          border: 2px solid #aaa !important;
          border-radius: 4px !important;
          box-shadow: 0 1px 0 #fff inset, 0 3px 8px rgba(0,0,0,0.20), 0 0 0 1px #c8102e inset !important;
          color: #1c1c1c !important;
        }
        button, .btn, .save-btn, .start-btn, .complete-btn, .submit, .schedule, .send-btn {
          background: linear-gradient(180deg, #d8112e, #9a0a20) !important;
          color: #fafafa !important;
          border: 1px solid #1c1c1c !important;
          font-family: 'Bebas Neue', sans-serif !important;
          letter-spacing: 0.10em !important;
          text-transform: uppercase !important;
          box-shadow: 0 2px 0 #6a0a18, 0 3px 6px rgba(0,0,0,0.3) !important;
        }
        input, select, textarea {
          background: #fff !important;
          color: #1c1c1c !important;
          border: 1px solid #888 !important;
          font-family: 'Special Elite', monospace !important;
        }
        input:focus, select:focus, textarea:focus { border-color: #c8102e !important; outline: none !important; }
        a { color: #c8102e !important; }
        .stat-value, .job-id { font-family: 'Bebas Neue', sans-serif !important; color: #1c1c1c !important; }
      `,
    },

    // ── LEE (id 4) — Deadpool: red + black + comic flair ──
    4: {
      name: 'Deadpool',
      tagline: 'Maximum effort.',
      mark: '🗡️',
      accent: '#e8252f',
      fonts: ['https://fonts.googleapis.com/css2?family=Bangers&family=Inter:wght@400;700&display=swap'],
      css: `
        body {
          background:
            radial-gradient(circle at 20% 30%, rgba(232,37,47,0.10), transparent 40%),
            radial-gradient(circle at 80% 70%, rgba(232,37,47,0.08), transparent 40%),
            #0e0e0e !important;
          color: #f0f0f0 !important;
          font-family: 'Inter', system-ui, sans-serif !important;
        }
        h1, h2, h3, .title, .header h1, .topbar h1, .nav-pill, .quick-action {
          font-family: 'Bangers', 'Inter', sans-serif !important;
          letter-spacing: 0.05em !important;
          color: #e8252f !important;
          text-shadow: 2px 2px 0 #000 !important;
        }
        .job-card, .stat-card, .auth-card, .modal-card, .tdr-form, .chat-msg, .pill, .nav-pill {
          background: linear-gradient(180deg, #1a1a1a, #111) !important;
          border: 2px solid #e8252f !important;
          border-radius: 4px !important;
          box-shadow: 4px 4px 0 #e8252f, 0 2px 8px rgba(0,0,0,0.5) !important;
          color: #f0f0f0 !important;
        }
        button, .btn, .save-btn, .start-btn, .complete-btn, .submit, .schedule, .send-btn {
          background: #e8252f !important;
          color: #fff !important;
          border: 2px solid #000 !important;
          font-family: 'Bangers', sans-serif !important;
          letter-spacing: 0.06em !important;
          text-transform: uppercase !important;
          box-shadow: 3px 3px 0 #000 !important;
        }
        button:hover { transform: translate(1px, 1px) !important; box-shadow: 2px 2px 0 #000 !important; }
        input, select, textarea {
          background: #1a1a1a !important;
          color: #f0f0f0 !important;
          border: 2px solid #e8252f !important;
          font-family: 'Inter', sans-serif !important;
        }
        a { color: #e8252f !important; }
        .stat-value { font-family: 'Bangers', sans-serif !important; color: #fff !important; }
      `,
    },

    // ── BILLY (id 5) — Cajun coast placeholder ──
    5: {
      name: 'Bayou',
      tagline: 'Laissez les bons temps rouler.',
      mark: '⚜️',
      accent: '#7a5230',
      fonts: ['https://fonts.googleapis.com/css2?family=Lora:wght@400;700&family=Playfair+Display:wght@700&display=swap'],
      css: `
        body {
          background:
            linear-gradient(135deg, rgba(122,82,48,0.06), transparent 60%),
            #f1ead8 !important;
          color: #2a1c0a !important;
          font-family: 'Lora', Georgia, serif !important;
        }
        h1, h2, h3, .title { font-family: 'Playfair Display', serif !important; color: #5c3a0a !important; }
        .job-card, .stat-card, .auth-card, .modal-card, .tdr-form {
          background: #fbf6e8 !important;
          border: 1px solid #c4a572 !important;
          color: #2a1c0a !important;
        }
        button, .btn { background: #7a5230 !important; color: #fff !important; }
      `,
    },

    // ── JOHN (id 6) — NASCAR: checkered flag + racing red/blue/white ──
    6: {
      name: 'NASCAR',
      tagline: 'Boogity boogity boogity.',
      mark: '🏁',
      accent: '#e10600',
      fonts: ['https://fonts.googleapis.com/css2?family=Russo+One&family=Roboto+Condensed:wght@400;700&display=swap'],
      css: `
        body {
          background:
            linear-gradient(90deg, transparent 0%, transparent 80%, rgba(225,6,0,0.03) 80%, rgba(225,6,0,0.03) 100%),
            #f4f4f4 !important;
          color: #1a1a1a !important;
          font-family: 'Roboto Condensed', system-ui, sans-serif !important;
        }
        h1, h2, h3, .title, .header h1, .topbar h1, .nav-pill, .quick-action {
          font-family: 'Russo One', sans-serif !important;
          letter-spacing: 0.04em !important;
          text-transform: uppercase !important;
          color: #1a1a1a !important;
        }
        /* Checkered top accent bar across all card headers */
        .header, .topbar {
          background:
            repeating-linear-gradient(45deg, #000 0 12px, #fff 12px 24px) !important;
          color: #1a1a1a !important;
          border-bottom: 4px solid #e10600 !important;
        }
        .header .title, .topbar h1 {
          background: rgba(255,255,255,0.92);
          padding: 4px 12px;
          border-radius: 4px;
          display: inline-block;
        }
        .job-card, .stat-card, .auth-card, .modal-card, .tdr-form, .pill, .nav-pill {
          background: #fff !important;
          border: 1px solid #1a1a1a !important;
          border-left: 6px solid #e10600 !important;
          border-radius: 4px !important;
          box-shadow: 0 2px 6px rgba(0,0,0,0.15) !important;
          color: #1a1a1a !important;
        }
        button, .btn, .save-btn, .start-btn, .complete-btn, .submit, .schedule, .send-btn {
          background: #e10600 !important;
          color: #fff !important;
          border: 2px solid #1a1a1a !important;
          font-family: 'Russo One', sans-serif !important;
          letter-spacing: 0.06em !important;
          text-transform: uppercase !important;
          box-shadow: 0 2px 0 #1a1a1a !important;
        }
        input, select, textarea {
          background: #fff !important;
          color: #1a1a1a !important;
          border: 1px solid #888 !important;
          font-family: 'Roboto Condensed', sans-serif !important;
        }
        input:focus, select:focus, textarea:focus { border-color: #e10600 !important; outline: none !important; }
        a { color: #003da5 !important; }
        .stat-value { font-family: 'Russo One', sans-serif !important; color: #e10600 !important; }
      `,
    },
  };

  const theme = THEMES[techId];
  if (!theme) return; // Unknown tech → no theme

  // Load fonts
  (theme.fonts || []).forEach(loadFont);

  // Inject CSS
  const style = document.createElement('style');
  style.id = 'tech-theme-css';
  style.textContent = theme.css;
  document.head.appendChild(style);

  // Inject a subtle badge in the corner: <mark> <name>
  function addBadge() {
    if (document.getElementById('tech-theme-badge')) return;
    const badge = document.createElement('div');
    badge.id = 'tech-theme-badge';
    badge.title = theme.tagline;
    badge.style.cssText = `
      position: fixed;
      bottom: 8px;
      right: 8px;
      background: rgba(0,0,0,0.55);
      color: ${theme.accent};
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      font-family: system-ui, sans-serif;
      z-index: 9998;
      pointer-events: auto;
      cursor: default;
      user-select: none;
      border: 1px solid ${theme.accent};
    `;
    badge.textContent = `${theme.mark} ${theme.name}`;
    document.body.appendChild(badge);
  }
  if (document.body) addBadge();
  else document.addEventListener('DOMContentLoaded', addBadge);
  setTimeout(addBadge, 500);
})();
