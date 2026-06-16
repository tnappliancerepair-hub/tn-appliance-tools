// Per-supplier config for parts lookups. The login URL is where you sign in once
// (the live-session daemon keeps the tab open so the session persists).
// `searchUrl(q)` is the search URL; if a portal needs a typed search instead, set
// `searchSelector` (the search box) and we'll type + Enter.
//
// TIERS (read `tier`):
//   'price'     — OUR numbers: Marcone = OEM cost we order at, Amazon = aftermarket
//                 tier + ship-to-customer ordering. These set the cash-TDR 4 options.
//   'reference' — GENERAL parts search: find the right part #, exploded diagrams,
//                 cross-reference, retail sanity-check price. Not our cost.
//
// LOOKUP IDENTIFIER (read `lookupBy`):
//   'model'  (default) — search by appliance model number
//   'serial' — Samsung especially: the exact part variant is tied to the
//              production run, which the SERIAL encodes (model alone is ambiguous).
//              Daemon accepts ?serial= and passes it here; falls back to model.

module.exports = {
  // ── PRICE TIER (our cost / what we charge) ──────────────────────────────────
  marcone: {
    label: 'Marcone',
    tier: 'price',
    primary: true, // OEM cost source — what we order at
    loginUrl: 'https://my.marcone.com/UserLogin',
    // Real Marcone search-by-model endpoint (confirmed live).
    searchUrl: (q) => 'https://my.marcone.com/Home/RunSearchPartModelList?searchString=' + encodeURIComponent(q) + '&type=Part',
    searchSelector: null,
    // a logged-in page shows this; if missing we know the session died
    loggedInHint: 'a[href*="logout" i], a[href*="signout" i], .account, #account',
  },
  amazon: {
    label: 'Amazon Business',
    tier: 'price',
    primary: true, // aftermarket-equivalent tier + ship-to-customer ordering
    loginUrl: 'https://www.amazon.com/gp/sign-in.html',
    searchUrl: (q) => 'https://www.amazon.com/s?k=' + encodeURIComponent(q + ' appliance part'),
    searchSelector: 'input#twotabsearchtextbox, input[type="text"][name="field-keywords"]',
    loggedInHint: '#nav-link-accountList-nav-line-1, a[href*="sign-out" i]',
  },

  // ── REFERENCE TIER (general parts search: right part # + diagrams + cross-ref) ─
  searspartsdirect: {
    label: 'Sears PartsDirect',
    tier: 'reference',
    noLogin: true, // public — authoritative part # by model + exploded diagrams + retail price
    loginUrl: 'https://www.searspartsdirect.com/',
    searchUrl: (q) => 'https://www.searspartsdirect.com/search?q=' + encodeURIComponent(q),
    searchSelector: 'input[type="search"], input[name*="search" i], input#searchInput, input[placeholder*="model" i], input[placeholder*="part" i]',
    loggedInHint: null,
  },
  tribles: {
    label: 'Tribles',
    tier: 'reference', // we have an account; useful cross-reference (Marcone is our price source)
    loginUrl: 'https://www.triblesinc.com/login',
    searchUrl: (q) => 'https://www.triblesinc.com/search?q=' + encodeURIComponent(q),
    searchSelector: 'input[type="search"], input[name*="search" i], input[id*="search" i]',
    loggedInHint: 'a[href*="logout" i], a[href*="signout" i], .account, #account',
  },
  samsung: {
    label: 'Samsung Parts (OEM)',
    tier: 'reference',
    noLogin: true, // public genuine-Samsung parts
    lookupBy: 'serial', // Samsung: the exact part depends on the production variant the SERIAL encodes
    note: 'Samsung varies parts by production run — use the SERIAL (or full model incl. the /XX suffix). Model alone can return the wrong variant.',
    loginUrl: 'https://www.samsungparts.com/',
    searchUrl: (q) => 'https://www.samsungparts.com/Products?SearchTerm=' + encodeURIComponent(q),
    searchSelector: 'input[type="search"], input[name="SearchTerm"], input[name="q"], input[placeholder*="search" i], input[placeholder*="model" i], input[placeholder*="serial" i]',
    loggedInHint: null,
  },
  lg: {
    label: 'LG Parts (OEM)',
    tier: 'reference',
    noLogin: true, // public genuine-LG parts (use when the appliance is LG)
    loginUrl: 'https://www.lg.com/us/support/repair-service/lg-parts-accessories',
    searchUrl: (q) => 'https://www.encompass.com/model/' + encodeURIComponent(q) + '/?mfg=LG',
    searchSelector: 'input[type="search"], input[name="q"], input[placeholder*="search" i], input[placeholder*="model" i]',
    loggedInHint: null,
  },
  // ── AUTHENTICATED BRAND PORTAL (intelligence-first: per-model troubleshooting,
  // tech sheets, RECALLS + technical service bulletins, plus parts lookup) ──────
  // Whirlpool University / Whirlpool-family servicer portal. Covers Whirlpool,
  // Maytag, KitchenAid, Amana, Jenn-Air, Roper, Estate. We authenticate as an
  // authorized servicer; the SAME session feeds parts AND the troubleshooting brain
  // (same pattern as Marcone/MSA World — "one login, parts AND the brain").
  // NOTE: confirm the real login + search URLs on first login (Marcone's were wrong
  // until we logged in — same expectation here). Marcone is already our Whirlpool-
  // family PRICE source, so this entry is primarily for intelligence + recalls/TSBs.
  whirlpool: {
    label: 'Whirlpool University',
    tier: 'reference',
    intelligence: true, // feeds troubleshooting / tech sheets / recalls / TSBs, not just parts
    brands: ['whirlpool', 'maytag', 'kitchenaid', 'amana', 'jenn-air', 'jennair', 'roper', 'estate'],
    confirmOnLogin: true, // URLs below are best-guess until we see the real portal
    loginUrl: 'https://www.whirlpoolservicematters.com/',
    searchUrl: (q) => 'https://www.whirlpoolservicematters.com/search?model=' + encodeURIComponent(q),
    searchSelector: 'input[type="search"], input[name*="model" i], input[id*="search" i], input[placeholder*="model" i]',
    note: 'Whirlpool-family per-model troubleshooting + recalls + technical service bulletins. Confirm portal URLs on first login; Marcone remains our Whirlpool-family parts PRICE source.',
    loggedInHint: 'a[href*="logout" i], a[href*="signout" i], .account, #account, [class*="account" i]',
  },

  // MSA World (Marcone Servicers Association) — THE authoritative intelligence
  // anchor. Member-licensed manuals, tech sheets, fault codes, RECALLS + technical
  // service bulletins, across ALL brands. Accessed via our Marcone membership →
  // same authenticated-browser pattern (one session, parts AND the brain).
  // INTELLIGENCE source (recalls/bulletins/tech-sheets), not a price source.
  // IP-clean rule: on-demand, model-specific, for OUR service work — never
  // bulk-mirror their library. Confirm real portal URLs on first login.
  msa: {
    label: 'MSA World',
    tier: 'reference',
    intelligence: true,
    // Confirmed live 2026-06-16: authenticated portal is members.msaworld.com,
    // search is /Search?query=<model>, login uses MyMarcone credentials.
    loginUrl: 'https://members.msaworld.com/',
    searchUrl: (q) => 'https://members.msaworld.com/Search?query=' + encodeURIComponent(q),
    searchSelector: 'input[type="search"], input[name*="search" i], input[id*="search" i], input[placeholder*="model" i]',
    note: 'Member-licensed manuals / tech sheets / fault codes / recalls / TSBs (all brands), via Marcone membership. On-demand + model-specific only — do NOT bulk-mirror.',
    loggedInHint: 'a[href*="logout" i], a[href*="logoff" i], a[href*="signout" i], a[href*="log-out" i]',
  },

  // Broad multi-brand public catalogs — cover EVERY brand incl. Sub-Zero, Viking,
  // Wolf, Thermador, etc. by model. No login. Great cross-reference + retail price.
  appliancepartspros: {
    label: 'AppliancePartsPros',
    tier: 'reference',
    noLogin: true,
    loginUrl: 'https://www.appliancepartspros.com/',
    searchUrl: (q) => 'https://www.appliancepartspros.com/search.aspx?model=' + encodeURIComponent(q),
    searchSelector: 'input[type="search"], input[name*="model" i], input[id*="search" i], input[placeholder*="model" i]',
    loggedInHint: null,
  },
  partselect: {
    label: 'PartSelect',
    tier: 'reference',
    noLogin: true,
    loginUrl: 'https://www.partselect.com/',
    searchUrl: (q) => 'https://www.partselect.com/Search/?SearchTerm=' + encodeURIComponent(q),
    searchSelector: 'input[type="search"], input[name="SearchTerm"], input[id*="search" i], input[placeholder*="model" i]',
    loggedInHint: null,
  },
};
