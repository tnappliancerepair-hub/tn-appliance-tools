// shop-subdomain — routes each tenant's branded subdomain to their auto-built site.
// joeys-appliance.applianceant.com  ->  /.netlify/functions/platform-site?slug=joeys-appliance
//
// SAFETY: this runs on every request to the site, but it is a pass-through by default — it ONLY
// rewrites a request whose Host is a subdomain of applianceant.com (and not a reserved one). Any
// other host (tnapplianceexchange.net, the apex applianceant.com, anything unexpected) returns
// context.next() immediately, unchanged. Wrapped in try/catch so a failure can never break a page.
export default async (request, context) => {
  try {
    const host = (request.headers.get('host') || '').toLowerCase().split(':')[0];
    const m = /^([a-z0-9][a-z0-9-]{0,62})\.applianceant\.com$/.exec(host);
    if (!m) return context.next();                       // not a shop subdomain — leave it alone
    const sub = m[1];
    const RESERVED = new Set(['www', 'app', 'api', 'admin', 'platform', 'mail', 'ftp', 'ns1', 'ns2',
      'cdn', 'static', 'assets', 'dev', 'staging', 'test', 'blog', 'shop', 'store', 'my', 'portal', 'go', 'get']);
    if (RESERVED.has(sub)) return context.next();
    const url = new URL(request.url);
    // Don't touch function calls or platform app assets even on a subdomain.
    if (url.pathname.startsWith('/.netlify') || url.pathname.startsWith('/platform/')) return context.next();
    return context.rewrite(`/.netlify/functions/platform-site?slug=${encodeURIComponent(sub)}`);
  } catch (_) {
    return context.next();
  }
};
export const config = { path: '/*' };
