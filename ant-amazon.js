// ant-amazon.js — the ONE swappable "Amazon-equivalent part" link layer.
//
// THE MODEL (Teddy 2026-08-01): our aftermarket / "Amazon-equivalent" tier lives as
// OUR OWN Amazon listings, fulfilled by Amazon. We send our traffic there and collect
// Amazon's Brand Referral Bonus (~10%) on top of the sale. OEM stays our own drop-ship.
//
// PHASED — the same slots flip with one config change, no page edits:
//   mode:'associates' → tagged Amazon SEARCH link (small referral fee). Live in days.
//   mode:'brb'        → our own listing URLs + Attribution tag (full sale + ~10% bonus).
//
// GUARDRAILS baked in:
//   • Secondary only — never competes with the intake/book CTA (funnel is protected).
//   • Framed for DIY / out-of-area traffic we otherwise earn $0 from.
//   • Searches by appliance + brand + component — NEVER the exact diagnosed OEM part #
//     (standing rule: we don't hand customers the part number).
//   • Renders ONLY on public info/SEO pages; hard denylist for app/office/tech/txn pages.
(function () {
  'use strict';

  // ---- CONFIG (Teddy pastes the Associates tag; flip enabled=true to go live) ----
  var CFG = {
    enabled: false,              // master switch — stays off until the tag is set
    mode: 'associates',          // 'associates' (phase 1) | 'brb' (phase 2, our listings)
    tag: 'tnappliance-20',       // ← Amazon Associates store id (placeholder until real one)
    // phase 2 only: map component-key -> our Amazon listing (ASIN/URL) + attribution tag
    brbListings: {},             // e.g. { 'dryer|heating-element': 'https://www.amazon.com/dp/ASIN?maas=...&ref_=...' }
    brbAttrTag: ''               // Amazon Attribution tag applied to listing links
  };

  // ---- page-type guard: only public info/SEO pages ----
  var path = location.pathname.toLowerCase();
  var DENY = ['/office', '/tech', '/admin', '/dashboard', '/money', '/cash-tdr', '/teddy-tdr',
    '/appliance-ai', '/warranty-review', '/needs-scheduled', '/callbacks', '/customer-portal',
    '/cash-board', '/waiver', '/sign', '/upload', '/finish-upload', '/pay', '/verify',
    '/vendor-', '/creator', '/video-studio', '/social-', '/review-cards', '/content-ideas',
    '/office-', '/tech-', '/get-', '/gbp-', '/owner-'];
  function denied() { for (var i = 0; i < DENY.length; i++) { if (path.indexOf(DENY[i]) === 0 || path.indexOf(DENY[i]) > -1 && /\/(office|tech|admin)/.test(path)) return true; } return false; }

  // ---- derive context from the URL slug (+ <title> as fallback) ----
  var APPL = [
    // dishwasher BEFORE washer (else "dishwasher" matches the washer rule)
    ['dishwasher', /dishwasher|posudomoe|may-rua-chen|xiwanji|ghassalat|lavavajillas|lave-vaisselle/],
    ['refrigerator', /refriger|fridge|holodilnik|tu-lanh|bingxiang|thalaja|nevera|refrigerador|refrigerateur/],
    ['dryer', /\bdryer|sushilnaya|may-say|hongganji|nashafa|secadora|seche-linge|dryer-vent|vent-clean/],
    ['washer', /washer|washing|stiralnaya|may-giat|xiyiji|ghassala|lavadora|lave-linge/],
    ['oven', /\boven|\brange\b|stove|cooktop|plita|bep-lo|kaoxiang|\bfurn\b|estufa|\bfour\b/],
    ['microwave', /microwave/], ['freezer', /freezer|congelador/]
  ];
  // word-boundary match so short brands ("ge","lg") don't hit "pa[ge]"/"[lg]" inside words
  var BRANDS = ['whirlpool', 'samsung', 'lg', 'ge', 'frigidaire', 'maytag', 'bosch', 'kenmore', 'kitchenaid', 'amana', 'electrolux'];
  var COMP = [
    ['heating element', /not-heating|no-heat|wont-heat|no-calienta/],
    ['drain pump', /wont-drain|no-drain|not-drain|no-drena/],
    ['not cooling repair', /not-cooling|wont-cool|no-cooling|no-enfria/],
    ['door seal gasket', /leak|leaking|door-seal|gasket/],
    ['igniter bake element', /wont-heat.*oven|oven.*not-heating/],
    ['drive belt', /wont-spin|not-spin|no-spin/]
  ];
  function pick(list, hay) { for (var i = 0; i < list.length; i++) { if (list[i][1].test(hay)) return list[i][0]; } return ''; }

  function ctx() {
    var hay = path + ' ' + (document.title || '').toLowerCase();
    var appliance = pick(APPL, hay);
    var brand = ''; for (var i = 0; i < BRANDS.length; i++) { if (new RegExp('\\b' + BRANDS[i] + '\\b').test(hay)) { brand = BRANDS[i]; break; } }
    var comp = pick(COMP, hay);
    return { appliance: appliance, brand: brand, comp: comp };
  }

  function key(c) { return (c.appliance || 'appliance') + '|' + (c.comp || '').replace(/\s+/g, '-'); }

  // ---- build the Amazon URL for the current mode ----
  function amazonUrl(c) {
    if (CFG.mode === 'brb') {
      var u = CFG.brbListings[key(c)] || CFG.brbListings[(c.appliance || '') + '|'] || '';
      return u || null; // no listing yet → caller hides the CTA
    }
    // associates: a SEARCH link by brand+appliance+component (never the exact OEM part #)
    var terms = [c.brand, c.appliance, c.comp || 'replacement part'].filter(Boolean).join(' ');
    return 'https://www.amazon.com/s?k=' + encodeURIComponent(terms) + '&tag=' + encodeURIComponent(CFG.tag);
  }

  // expose the builder for tests / other surfaces (e.g. cash-tdr Amazon tier later)
  window.AntAmazon = { build: function (over) { var c = over || ctx(); return { ctx: c, url: amazonUrl(c) }; }, cfg: CFG };

  if (typeof document === 'undefined') return;      // node test guard
  if (!CFG.enabled || denied()) return;

  function render() {
    var c = ctx();
    var url = amazonUrl(c);
    if (!url) return;                                // brb with no listing → show nothing
    var applLabel = c.appliance ? c.appliance : 'appliance';
    var slot = document.getElementById('ant-amazon-slot');
    var host = slot || (function () {
      // no explicit slot → drop it right after the first primary CTA, else skip
      var cta = document.querySelector('.btn-primary, .cta, .cc-go');
      if (!cta) return null;
      var d = document.createElement('div'); d.id = 'ant-amazon-slot';
      (cta.closest('.cta-inner, .hero, section, div') || cta.parentNode).appendChild(d);
      return d;
    })();
    if (!host) return;
    host.innerHTML =
      '<div style="margin-top:14px;font-size:13px;line-height:1.6;color:#8a8a8a;text-align:center">' +
      'Prefer to fix it yourself, or outside our TN/LA service area? ' +
      '<a href="' + url + '" target="_blank" rel="nofollow sponsored noopener" ' +
      'data-ant-amazon="1" style="color:#ff6200;text-decoration:none;border-bottom:1px solid rgba(255,98,0,.4)">' +
      'Get the ' + applLabel + ' part on Amazon →</a>' +
      '<div style="font-size:10.5px;color:#5a5a5a;margin-top:6px">As an Amazon Associate we earn from qualifying purchases.</div>' +
      '</div>';
    try { if (window.gtag) { var a = host.querySelector('a'); a && a.addEventListener('click', function () { gtag('event', 'amazon_part_click', { appliance: c.appliance || '', brand: c.brand || '', mode: CFG.mode }); }); } } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
