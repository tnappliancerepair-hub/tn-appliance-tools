// platform-site — the auto-built shop website. One function serves EVERY tenant's public site,
// rendered live from their company row (no static files, near-zero hosting). A shop signs up,
// gives us their name + trade + town, and this is their website — with their Ann number answering
// it. Public (no auth); reads only safe marketing fields via the service key server-side.
//
//   GET /.netlify/functions/platform-site?slug=<company-slug>   (pretty route: /s/<slug>)
//     -> a clean, trade-themed one-pager: call/text their AI line + a "request service" form
//        that drops the lead straight on their board (platform-lead).
'use strict';

const { platform } = require('./_lib/platform-rest');

const SITE = 'https://tnapplianceexchange.net';

// Trade → accent + the words + default services (used when the shop hasn't customized).
const TRADE = {
  appliance: { accent: '#3f8f24', emoji: '🔧', noun: 'appliance repair', verb: 'fix', services: ['Refrigerators & Freezers', 'Washers & Dryers', 'Dishwashers', 'Ovens, Ranges & Cooktops', 'Ice Makers', 'Garbage Disposals'] },
  automotive: { accent: '#c0392b', emoji: '🔩', noun: 'auto repair', verb: 'fix', services: ['Brakes & Rotors', 'Oil & Fluids', 'Diagnostics & Check-Engine', 'A/C & Heating', 'Batteries & Electrical', 'Tune-ups'] },
  hvac: { accent: '#1f6feb', emoji: '❄️', noun: 'HVAC service', verb: 'service', services: ['A/C Repair', 'Heating & Furnace', 'Installs & Replacements', 'Maintenance Tune-ups', 'Thermostats', 'Indoor Air Quality'] },
  furniture: { accent: '#7c4a1e', emoji: '🛋️', noun: 'furniture service', verb: 'handle', services: ['Delivery', 'Assembly', 'Repair & Touch-up', 'Custom Orders', 'Upholstery', 'Pickup & Haul-away'] },
  aquarium: { accent: '#1b6ca8', emoji: '🐠', noun: 'aquarium service', verb: 'service', services: ['Tank Maintenance', 'Water Testing', 'Equipment Repair', 'Setup & Design', 'Livestock Health', 'Emergency Service'] },
  dealership: { accent: '#b8860b', emoji: '🚗', noun: 'dealership', verb: 'help with', services: ['Inventory', 'Financing', 'Trade-ins', 'Test Drives', 'Service Department', 'Warranty'] },
};
function tradeCfg(t) { return TRADE[String(t || 'appliance').toLowerCase()] || TRADE.appliance; }

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function fmtPhone(d) { const n = String(d || '').replace(/\D/g, '').replace(/^1/, ''); return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : String(d || ''); }
function telHref(d) { const n = String(d || '').replace(/\D/g, ''); return n ? '+' + (n.length === 10 ? '1' + n : n) : ''; }

function J(code, body) { return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) }; }
function H(code, html) { return { statusCode: code, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' }, body: html }; }

function notFound(slug) {
  return H(404, `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Not found</title><body style="font-family:system-ui;background:#0f1310;color:#eef2e8;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center"><div><div style="font-size:40px">🐜</div><h1>Shop not found</h1><p style="color:#9aa595">No site for "${esc(slug)}". <a href="${SITE}/platform/home.html" style="color:#7fce5e">See Ant →</a></p></div></body>`);
}

function render(c) {
  const cfg = tradeCfg(c.trade);
  const s = (c.settings && c.settings.site) || {};
  const biz = (c.settings && c.settings.business) || {};
  const phone = (c.settings && c.settings.phone) || {};
  const name = c.name || 'Our Shop';
  const accent = s.accent || cfg.accent;
  const city = s.city || biz.city || '';
  const state = biz.state || '';
  const locale = [city, state].filter(Boolean).join(', ');
  const num = phone.number || '';
  const tel = telHref(num), disp = fmtPhone(num);
  const services = (Array.isArray(s.services) && s.services.length) ? s.services : cfg.services;
  const tagline = s.tagline || `Fast, honest ${cfg.noun}${locale ? ' in ' + locale : ''}. We answer 24/7 — call or text.`;
  const about = s.about || (c.settings && c.settings.ai && c.settings.ai.about) || '';
  const yrs = biz.since ? `Serving ${locale || 'our community'} since ${esc(biz.since)}.` : '';

  const callBtns = num
    ? `<a class="cta call" href="tel:${tel}">📞 Call ${esc(disp)}</a><a class="cta text" href="sms:${tel}">💬 Text us</a>`
    : `<a class="cta call" href="#book">📋 Request service</a>`;

  return H(200, `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)} — ${esc(cfg.noun)}${locale ? ' in ' + esc(locale) : ''}</title>
<meta name="description" content="${esc(name)}: ${esc(cfg.noun)}${locale ? ' in ' + esc(locale) : ''}. We answer 24/7 — call or text. Book fast, honest service.">
<meta property="og:title" content="${esc(name)} — ${esc(cfg.noun)}"><meta property="og:description" content="${esc(tagline)}"><meta property="og:type" content="website">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'LocalBusiness', name, telephone: num ? '+' + tel.replace('+', '') : undefined, areaServed: locale || undefined, address: locale ? { '@type': 'PostalAddress', addressLocality: city, addressRegion: state } : undefined })}</script>
<style>
  :root{--ink:#12160f;--bg:#ffffff;--soft:#f5f7f2;--muted:#5b6152;--line:#e6e9df;--accent:${accent};--accent-ink:${accent}}
  *{box-sizing:border-box}body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased}
  .wrap{max-width:900px;margin:0 auto;padding:0 20px}
  header{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
  .bar{max-width:900px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:10px}
  .logo{font-weight:800;letter-spacing:-.01em;font-size:18px}
  .bar .ph{margin-left:auto;font-weight:800;color:var(--accent);text-decoration:none;font-size:15px}
  .hero{background:linear-gradient(180deg,var(--soft),var(--bg));padding:52px 0 40px;text-align:center}
  .em{font-size:34px}
  h1{font-size:38px;line-height:1.12;letter-spacing:-.02em;margin:14px auto 12px;max-width:18ch;text-wrap:balance}
  .tag{font-size:18px;color:var(--muted);max-width:52ch;margin:0 auto 26px}
  .ctas{display:flex;flex-wrap:wrap;gap:12px;justify-content:center}
  .cta{display:inline-flex;align-items:center;gap:8px;font-weight:800;font-size:17px;padding:15px 24px;border-radius:13px;text-decoration:none}
  .cta.call{background:var(--accent);color:#fff;box-shadow:0 8px 22px ${accent}44}
  .cta.text{background:#fff;color:var(--ink);border:1.5px solid var(--line)}
  .badge{margin-top:16px;display:inline-flex;gap:7px;align-items:center;color:var(--muted);font-size:13.5px}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px ${accent}22}
  section{padding:44px 0}
  h2{font-size:26px;letter-spacing:-.01em;text-align:center;margin:0 0 8px}
  .sub{color:var(--muted);text-align:center;margin:0 auto 26px;max-width:52ch}
  .svc{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  .svc div{background:var(--soft);border:1px solid var(--line);border-radius:13px;padding:16px 18px;font-weight:700;font-size:15px}
  .why{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  .why div{text-align:center;padding:8px}
  .why .e{font-size:26px}.why b{display:block;margin:8px 0 3px}.why p{margin:0;color:var(--muted);font-size:14px}
  form{max-width:520px;margin:0 auto;background:var(--soft);border:1px solid var(--line);border-radius:16px;padding:22px}
  label{display:block;font-weight:700;font-size:13px;margin:12px 2px 5px}
  input,textarea{width:100%;padding:12px;border:1px solid var(--line);border-radius:10px;font-size:16px;font-family:inherit;background:#fff;color:var(--ink)}
  button{width:100%;margin-top:16px;padding:14px;border:0;border-radius:11px;background:var(--accent);color:#fff;font-weight:800;font-size:16px;cursor:pointer}
  .msg{margin-top:12px;padding:12px;border-radius:10px;font-size:14px;display:none}
  .msg.ok{display:block;background:${accent}18;color:var(--accent-ink)}
  .msg.err{display:block;background:#fde8e8;color:#b4472e}
  footer{border-top:1px solid var(--line);padding:26px 0 40px;text-align:center;color:var(--muted);font-size:13px}
  .callbar{position:fixed;left:0;right:0;bottom:0;z-index:30;display:none;gap:0;box-shadow:0 -4px 20px rgba(0,0,0,.12)}
  .callbar a{flex:1;text-align:center;padding:15px;font-weight:800;text-decoration:none;font-size:16px}
  .callbar .c{background:var(--accent);color:#fff}.callbar .t{background:#fff;color:var(--ink)}
  @media(max-width:640px){.svc{grid-template-columns:1fr 1fr}.why{grid-template-columns:1fr}h1{font-size:30px}.bar .ph{display:none}.callbar{display:flex}body{padding-bottom:56px}}
</style></head>
<body>
<header><div class="bar"><span class="logo">${esc(name)}</span>${num ? `<a class="ph" href="tel:${tel}">📞 ${esc(disp)}</a>` : ''}</div></header>
<div class="hero"><div class="wrap">
  <div class="em">${cfg.emoji}</div>
  <h1>${esc(name)}</h1>
  <p class="tag">${esc(tagline)}</p>
  <div class="ctas">${callBtns}</div>
  <div class="badge"><span class="dot"></span> We answer 24/7 — real help, day or night${yrs ? ' · ' + esc(yrs) : ''}</div>
</div></div>

<section><div class="wrap">
  <h2>What we ${cfg.verb}</h2>
  <p class="sub">${about ? esc(about) : `Whatever's broken, we handle it — fast, honest, and done right.`}</p>
  <div class="svc">${services.map((x) => `<div>${esc(x)}</div>`).join('')}</div>
</div></section>

<section style="background:var(--soft)"><div class="wrap">
  <h2>Why ${esc(name)}</h2>
  <div class="why">
    <div><div class="e">📞</div><b>We actually answer</b><p>Call or text any time — a real assistant picks up 24/7, day or night.</p></div>
    <div><div class="e">⚡</div><b>Fast, honest service</b><p>Straight answers, fair pricing, and we show up when we say we will.</p></div>
    <div><div class="e">🤝</div><b>Local & trusted</b><p>${locale ? esc(locale) + '’s' : 'Your'} go-to for ${esc(cfg.noun)} you can count on.</p></div>
  </div>
</div></section>

<section id="book"><div class="wrap">
  <h2>Request service</h2>
  <p class="sub">Tell us what's going on — we'll ${num ? 'call or text you right back' : 'reach out right away'}.</p>
  <form id="f" onsubmit="return sub(event)">
    <label>Your name</label><input id="n" required autocomplete="name">
    <label>Phone (so we can reach you)</label><input id="p" required inputmode="tel" autocomplete="tel">
    <label>What do you need?</label><textarea id="w" rows="3" required placeholder="e.g. fridge not cooling"></textarea>
    <label>City <span style="font-weight:400;color:var(--muted)">(optional)</span></label><input id="ci" autocomplete="address-level2">
    <button id="b">Request service →</button>
    <div class="msg" id="m"></div>
  </form>
</div></section>

<footer>${esc(name)}${locale ? ' · ' + esc(locale) : ''}${num ? ' · ' + esc(disp) : ''}<br><span style="font-size:11px;opacity:.7">Powered by 🐜 AssistAnt 24/7</span></footer>
${num ? `<div class="callbar"><a class="c" href="tel:${tel}">📞 Call</a><a class="t" href="sms:${tel}">💬 Text</a></div>` : ''}
<script>
function sub(e){e.preventDefault();var b=document.getElementById('b'),m=document.getElementById('m');b.disabled=true;b.textContent='Sending…';m.className='msg';
  fetch('${SITE}/.netlify/functions/platform-lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:${JSON.stringify(c.slug)},name:document.getElementById('n').value,phone:document.getElementById('p').value,what:document.getElementById('w').value,city:document.getElementById('ci').value,source:'website'})})
   .then(function(r){return r.json();}).then(function(d){ if(d&&d.ok){m.className='msg ok';m.textContent='Got it! We\\'ll be in touch right away.';document.getElementById('f').reset();b.textContent='Sent ✓';} else {m.className='msg err';m.textContent='Something went wrong — please call us instead.';b.disabled=false;b.textContent='Request service →';} })
   .catch(function(){m.className='msg err';m.textContent='Network hiccup — please call us instead.';b.disabled=false;b.textContent='Request service →';});
  return false;}
</script>
</body></html>`);
}

exports.config = { timeout: 15 };

// Pull the shop slug from a subdomain (joeys.applianceant.com -> "joeys"), as a fallback for
// when the request reaches us without ?slug= (the edge router normally supplies it).
function slugFromHost(event) {
  const host = String((event.headers && (event.headers.host || event.headers.Host)) || '').toLowerCase().split(':')[0];
  // Brand domains the platform serves shop subdomains on (Assistant 24/7 primary, applianceant legacy).
  const m = /^([a-z0-9][a-z0-9-]{0,62})\.(?:assistant247\.net|applianceant\.com)$/.exec(host);
  return m ? m[1] : '';
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const slug = String(q.slug || slugFromHost(event) || '').toLowerCase().trim();
  if (!slug) return J(400, { ok: false, error: 'slug required' });
  const pf = await platform();
  if (!pf) return H(200, notFound(slug).body);
  const sel = 'select=name,slug,trade,settings&limit=1';
  const key = encodeURIComponent(slug);
  let rows;
  // Resolve a subdomain hit three ways so the shop can use "the first part" of their name
  // (joeys.applianceant.com) OR the full slug (joeys-appliance.applianceant.com):
  //   1) exact slug              2) explicit short handle (settings.site.subdomain)
  //   3) slug prefix — "joeys" matches slug "joeys-appliance" (works for tenants made before
  //      the handle field existed, no backfill). The trailing "-*" keeps it a real prefix
  //      segment ("jo" won't match "joeys").
  const tries = [
    `company?slug=eq.${key}&${sel}`,
    `company?settings->site->>subdomain=eq.${key}&${sel}`,
    `company?slug=like.${key}-*&order=slug.asc&${sel}`,
  ];
  for (const qy of tries) {
    try { rows = await pf.get(qy); } catch (_) { rows = []; }
    if (rows && rows[0]) break;
  }
  const c = rows && rows[0];
  if (!c) return notFound(slug);
  return render(c);
};
