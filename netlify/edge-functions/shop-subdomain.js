// applianceant-router — routes the applianceant.com family on the PLATFORM Netlify site.
//   applianceant.com/            ->  /platform/home.html         (the marketing front door)
//   www.applianceant.com/        ->  /platform/home.html
//   joeys-appliance.applianceant.com  ->  platform-site?slug=joeys-appliance  (a shop's site)
//
// SAFETY: this runs on every request but is a pass-through by default. It ONLY rewrites requests
// whose Host is applianceant.com (apex/www at "/") or a non-reserved *.applianceant.com subdomain.
// EVERY other host (tnapplianceexchange.net, *.netlify.app, anything unexpected) and every other
// path returns context.next() unchanged. Wrapped in try/catch so a failure can never break a page.
// Fully reversible: delete this file.
export default async (request, context) => {
  try {
    const host = (request.headers.get('host') || '').toLowerCase().split(':')[0];
    const url = new URL(request.url);

    // ── Apex + www: serve the platform front door at "/" only ──
    if (host === 'applianceant.com' || host === 'www.applianceant.com') {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return context.rewrite('/platform/home.html');
      }
      return context.next();                               // every other path resolves normally
    }

    // ── Shop subdomains: <slug>.applianceant.com -> that shop's auto-built site ──
    const m = /^([a-z0-9][a-z0-9-]{0,62})\.applianceant\.com$/.exec(host);
    if (!m) return context.next();                         // not an applianceant host — leave it alone
    const sub = m[1];
    const RESERVED = new Set(['www', 'app', 'api', 'admin', 'platform', 'mail', 'ftp', 'ns1', 'ns2',
      'cdn', 'static', 'assets', 'dev', 'staging', 'test', 'blog', 'shop', 'store', 'my', 'portal', 'go', 'get']);
    if (RESERVED.has(sub)) return context.next();
    // Don't touch function calls or platform app assets even on a subdomain.
    if (url.pathname.startsWith('/.netlify') || url.pathname.startsWith('/platform/')) return context.next();
    return context.rewrite(`/.netlify/functions/platform-site?slug=${encodeURIComponent(sub)}`);
  } catch (_) {
    return context.next();
  }
};
export const config = { path: '/*' };
