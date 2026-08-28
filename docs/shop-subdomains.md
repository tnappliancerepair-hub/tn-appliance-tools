# Shop subdomains — `yourshop.applianceant.com`

Every tenant's auto-built website can serve at a branded subdomain, e.g.
`joeys-appliance.applianceant.com`. This is the pro look (like Housecall Pro's `yourshop.hcp.com`).
It costs **$0 per shop** — one wildcard covers all of them.

## How it works (code — DONE, deployed)

- **Edge router** (`netlify/edge-functions/shop-subdomain.js`) runs on the platform site. When a
  request's Host is `<slug>.applianceant.com`, it rewrites to `platform-site?slug=<slug>` and the
  shop's page renders. Every other host (tnapplianceexchange.net, the apex applianceant.com, etc.)
  passes straight through, unchanged — it's a defensive pass-through, wrapped in try/catch.
- **`platform-site.js`** also reads the slug from the Host as a fallback.

## What you need to do (DNS + Netlify — I can't touch DNS)

The apex `applianceant.com` stays on the **consumer site** (untouched). Only the **wildcard
subdomains** point at the **platform site** (the one this repo deploys to — `superlative-naiad-233aa7`).

1. **DNS** (wherever applianceant.com's DNS lives — Cloudflare/registrar): add a **wildcard CNAME**
   - Name: `*`  →  Target: `superlative-naiad-233aa7.netlify.app` (the platform site).
   - Leave the apex `applianceant.com` + `www` records exactly as they are (consumer site).
2. **Netlify** → the **platform site** → Domain management → **Add domain alias** → `*.applianceant.com`
   (wildcard). Netlify provisions a wildcard SSL cert (a few minutes).
3. Wait for DNS + cert, then hit `https://demo.applianceant.com` (or any tenant's slug) — it should
   render that shop's site.

**Note:** a wildcard cert + wildcard domain on Netlify may require the site's DNS to be on Netlify
DNS **or** the Cloudflare-style CNAME above; if Netlify won't issue the wildcard cert on an external
CNAME, the fallback is to host subdomains on a domain whose DNS is managed by Netlify. Either way the
code is ready — this is purely the domain wiring.

## Until then

Shop sites already work at **`applianceant.com/s/<slug>`** (or `tnapplianceexchange.net/s/<slug>`) —
no setup needed. The subdomain is just a nicer face on the same page.

## Heads-up (transparency)

Wiring subdomains required adding a Netlify **edge function** to the platform site. It runs on every
request but does nothing except rewrite `*.applianceant.com` subdomain hits — all other traffic is an
immediate pass-through. It's fully reversible (delete `netlify/edge-functions/shop-subdomain.js`).
