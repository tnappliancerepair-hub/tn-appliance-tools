# applianceant.com — the platform domain (front door + shop subdomains)

Decision (Teddy 2026-08-28): **use `applianceant.com`** as the Appliance Ant platform's public home.
It's already ours, so no new domain to buy. Two jobs on one domain, both $0 extra:

| URL | Serves |
|---|---|
| `applianceant.com` (apex) | the **marketing front door** (`platform/home.html`) → funnels shop owners into `signup.html` |
| `joeys.applianceant.com` | that **shop's auto-built website** — the pro look, like `yourshop.hcp.com` |

One wildcard covers every shop; adding a shop costs nothing.

**Short handles (Teddy 2026-08-28):** "appliance" and "repair" are already in the domain, so the
subdomain is just the shop's *name* — **"Joey's Appliance Repair" → `joeys.applianceant.com`**, not
`joeys-appliance-repair`. The handle is derived at provision (`shopHandle()` strips the generic
trade/legal words, keeps the first 1–2 real tokens) and stored on `settings.site.subdomain`; the owner
can override with `&subdomain=`. `platform-site` resolves a subdomain three ways — exact slug, the
stored handle, or a **slug prefix** (`joeys` → `joeys-appliance`) — so short handles also work for
shops provisioned before this existed, with no backfill. The full-slug subdomain still works too.

## The one thing to know first — the apex conflict

`applianceant.com` **currently serves the consumer DIY site** (a *separate* Netlify deploy, sourced from
the `/applianceant/` folder — the 79 fault-code pages). That DIY project is **backburnered** (Teddy: focus
the platform, it's the recurring revenue). So repointing `applianceant.com` at the **platform** site means
the consumer DIY pages stop showing at `applianceant.com`. That's the intended trade — but it IS a change,
so it's called out here. If you ever want the DIY pages back online, park that deploy on its own subdomain
(e.g. `diy.applianceant.com` — reserved in the router so it won't collide) and point a CNAME at it.

## How it works (code — DONE, deployed)

- **Edge router** (`netlify/edge-functions/shop-subdomain.js`) runs on the platform site:
  - Host `applianceant.com` / `www.applianceant.com` at `/` → rewrites to `platform/home.html` (front door).
    Every other path on the apex resolves normally (`/platform/signup.html`, `/apply`, `/s/<slug>`, functions).
  - Host `<slug>.applianceant.com` → rewrites to `platform-site?slug=<slug>` (that shop's page).
  - Every other host (tnapplianceexchange.net, *.netlify.app) and every reserved subdomain → straight
    pass-through, unchanged. Wrapped in try/catch so it can never break a page. Reversible (delete the file).
- **`platform-site.js`** also reads the slug from the Host as a fallback.
- The front door + signup + shop sites already work **today** at path URLs on the current platform domain:
  `tnapplianceexchange.net/platform/home.html`, `/platform/signup.html`, `/s/<slug>`. The applianceant.com
  wiring below is purely a nicer face on the same, already-live pages.

## Branded shop subdomains on Cloudflare Registrar — use a Worker (the wildcard workaround)

**Situation (2026-08-28):** the domain is registered at **Cloudflare Registrar**, which *locks the
nameservers to Cloudflare* — so we can't move DNS to Netlify, and **Netlify won't accept a
`*.assistant247.net` wildcard alias** (Netlify wildcards require Netlify-managed DNS). The apex +
`www` are added on Netlify and the **front door is live**; shop sites work at
`assistant247.net/s/<slug>`. To get the *branded* `joeys.assistant247.net` face, add a tiny
**Cloudflare Worker** that reverse-proxies each subdomain to the shop-site function (free, ~15 lines).

**Steps (one-time):**
1. Cloudflare dash → **Workers & Pages → Create → Create Worker** → name it `shop-subdomains` → Deploy.
2. **Edit code** → paste this, then Deploy:
   ```js
   export default {
     async fetch(request) {
       const host = (new URL(request.url).hostname || '').toLowerCase();
       const m = /^([a-z0-9][a-z0-9-]{0,62})\.assistant247\.net$/.exec(host);
       const RESERVED = new Set(['www', 'app', 'api', 'admin', 'platform']);
       if (m && !RESERVED.has(m[1])) {
         const target = 'https://superlative-naiad-233aa7.netlify.app/.netlify/functions/platform-site?slug=' + encodeURIComponent(m[1]);
         const r = await fetch(target);
         return new Response(r.body, { status: r.status, headers: r.headers });
       }
       return fetch(request); // apex/www/reserved pass straight through
     }
   };
   ```
3. Worker → **Settings → Domains & Routes → Add → Route** → Zone `assistant247.net`, Route
   `*.assistant247.net/*`. Save.
4. Test `https://demo.assistant247.net` → renders the demo shop. Done — every `<slug>.assistant247.net`
   now serves that shop, no per-shop setup.

(If Cloudflare ever adds Registrar support for external nameservers, or you move the domain, you can
instead use Netlify DNS + a native `*.assistant247.net` alias and delete the Worker.)

## What you do (DNS + Netlify — I can't touch DNS)

The platform site is the one this repo deploys to (`superlative-naiad-233aa7` / tnapplianceexchange.net).
Point `applianceant.com` at it:

1. **Move `applianceant.com` to the platform site.** In Netlify → **platform site** → Domain management →
   **Add a domain** → `applianceant.com` (and it'll offer `www` too). This takes it off the DIY deploy.
2. **DNS** (wherever applianceant.com's DNS lives): follow Netlify's instructions for that domain — typically
   an `ALIAS`/`ANAME`/flattened-CNAME on the apex to `superlative-naiad-233aa7.netlify.app`, and a `www` CNAME
   to the same. If DNS is on Netlify already, it wires this automatically.
3. **Wildcard for shop subdomains.** Add domain alias **`*.applianceant.com`** on the platform site, and a
   **wildcard `*` CNAME → `superlative-naiad-233aa7.netlify.app`** in DNS. Netlify provisions the wildcard
   SSL cert (a few minutes).
4. Wait for DNS + cert, then check: `https://applianceant.com` shows the front door, and
   `https://demo.applianceant.com` (or any tenant slug) shows that shop's site.

**SSL note:** a wildcard cert on Netlify is smoothest when the domain's DNS is **on Netlify DNS**. If you keep
DNS elsewhere (e.g. the registrar/Cloudflare) and Netlify won't issue the wildcard on an external CNAME, moving
just this domain's DNS to Netlify is the clean fix. The apex + `www` (non-wildcard) certs work fine either way.

## Heads-up (transparency)

- Wiring this added a Netlify **edge function** to the platform site. It runs on every request but does nothing
  except (a) serve the front door at the applianceant.com apex `/` and (b) route `*.applianceant.com` subdomains.
  All other traffic is an immediate pass-through. Fully reversible (delete `netlify/edge-functions/shop-subdomain.js`).
- Nothing here charges anyone or points at live billing — it's routing only. The go-live flags
  (`PLATFORM_SIGNUP_LIVE`, `PLATFORM_BILLING_LIVE`, `PLATFORM_PHONE_LIVE`) are still off and independent of this.
