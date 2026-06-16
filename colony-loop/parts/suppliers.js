// Per-supplier config for authenticated parts lookups. The login URL is where
// you sign in once (the session then persists in a per-supplier Chrome profile).
// `searchUrl(q)` is the best-guess search URL; if a portal needs a typed search
// instead, set `searchSelector` (the search box) and we'll type + Enter.
//
// These are STARTING POINTS — once you run a real login + lookup, paste the
// result page and we lock in the exact search URL + result selectors.

module.exports = {
  marcone: {
    label: 'Marcone',
    loginUrl: 'https://my.marcone.com/UserLogin',
    // After login we land on the dashboard; lookup types the model into the search box.
    searchUrl: (q) => 'https://my.marcone.com/',
    searchSelector: 'input[type="search"], input[name*="search" i], input[id*="search" i], input[placeholder*="search" i], input[placeholder*="part" i], input[placeholder*="model" i]',
    // a logged-in page shows this; if missing we know the session died
    loggedInHint: 'a[href*="logout" i], a[href*="signout" i], .account, #account',
  },
  tribles: {
    label: 'Tribles',
    loginUrl: 'https://www.triblesinc.com/login',
    searchUrl: (q) => 'https://www.triblesinc.com/search?q=' + encodeURIComponent(q),
    searchSelector: 'input[type="search"], input[name*="search" i], input[id*="search" i]',
    loggedInHint: 'a[href*="logout" i], a[href*="signout" i], .account, #account',
  },
  amazon: {
    label: 'Amazon Business',
    loginUrl: 'https://www.amazon.com/gp/sign-in.html',
    searchUrl: (q) => 'https://www.amazon.com/s?k=' + encodeURIComponent(q + ' appliance part'),
    searchSelector: 'input#twotabsearchtextbox, input[type="text"][name="field-keywords"]',
    loggedInHint: '#nav-link-accountList-nav-line-1, a[href*="sign-out" i]',
  },
  searspartsdirect: {
    label: 'Sears PartsDirect',
    noLogin: true, // public — authoritative part # by model + exploded diagrams + retail price
    loginUrl: 'https://www.searspartsdirect.com/',
    searchUrl: (q) => 'https://www.searspartsdirect.com/search?q=' + encodeURIComponent(q),
    searchSelector: 'input[type="search"], input[name*="search" i], input#searchInput, input[placeholder*="model" i], input[placeholder*="part" i]',
    loggedInHint: null,
  },
  lg: {
    label: 'LG Parts (OEM)',
    noLogin: true, // public genuine-LG parts (use when the appliance is LG)
    loginUrl: 'https://lgparts.com/',
    searchUrl: (q) => 'https://lgparts.com/search?q=' + encodeURIComponent(q),
    searchSelector: 'input[type="search"], input[name="q"], input[placeholder*="search" i], input[placeholder*="model" i]',
    loggedInHint: null,
  },
  samsung: {
    label: 'Samsung Parts (OEM)',
    noLogin: true, // public genuine-Samsung parts (use when the appliance is Samsung)
    loginUrl: 'https://samsungpartsusa.com/',
    searchUrl: (q) => 'https://samsungpartsusa.com/search?q=' + encodeURIComponent(q),
    searchSelector: 'input[type="search"], input[name="q"], input[placeholder*="search" i], input[placeholder*="model" i]',
    loggedInHint: null,
  },
};
