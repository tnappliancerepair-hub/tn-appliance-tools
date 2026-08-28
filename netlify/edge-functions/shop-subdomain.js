// ant247-router — routes the platform's brand domains on the PLATFORM Netlify site.
// Brand: Ant 24/7 (ant24x7.com). applianceant.com is kept working as a legacy/redirect domain.
//
//   ant24x7.com/            ->  /platform/home.html          (the marketing front door)
//   www.ant24x7.com/        ->  /platform/home.html
//   joeys.ant24x7.com       ->  platform-site?slug=joeys      (a shop's auto-built site)
//   applianceant.com/...    ->  same behavior (legacy)
//
// SAFETY: runs on every request but is a pass-through by default. It ONLY rewrites requests whose
// Host is one of the brand domains (apex/www at "/") or a non-reserved subdomain of one. EVERY other
// host (tnapplianceexchange.net, *.netlify.app, anything unexpected) and every other path returns
// context.next() unchanged. Wrapped in try/catch so a failure can never break a page. Reversible:
// delete this file. Add a new brand domain by adding its bare name to BRANDS.
const BRANDS = ['ant24x7', 'applianceant'];   // <name>.com — both apex + wildcard route here
export default async (request, context) => {
  try {
    const host = (request.headers.get('host') || '').toLowerCase().split(':')[0];
    const url = new URL(request.url);
    const apex = new RegExp('^(?:www\\.)?(' + BRANDS.join('|') + ')\\.com$');
    const sub  = new RegExp('^([a-z0-9][a-z0-9-]{0,62})\\.(?:' + BRANDS.join('|') + ')\\.com$');

    // ── Apex + www: serve the front door at "/" only ──
    if (apex.test(host)) {
      if (url.pathname === '/' || url.pathname === '/index.html') return context.rewrite('/platform/home.html');
      return context.next();                               // every other path resolves normally
    }

    // ── Shop subdomains: <slug>.<brand>.com -> that shop's site ──
    const m = sub.exec(host);
    if (!m) return context.next();                         // not a brand host — leave it alone
    const slug = m[1];
    const RESERVED = new Set(['www', 'app', 'api', 'admin', 'platform', 'mail', 'ftp', 'ns1', 'ns2',
      'cdn', 'static', 'assets', 'dev', 'staging', 'test', 'blog', 'shop', 'store', 'my', 'portal', 'go', 'get']);
    if (RESERVED.has(slug)) return context.next();
    if (url.pathname.startsWith('/.netlify') || url.pathname.startsWith('/platform/')) return context.next();
    return context.rewrite(`/.netlify/functions/platform-site?slug=${encodeURIComponent(slug)}`);
  } catch (_) {
    return context.next();
  }
};
export const config = { path: '/*' };
