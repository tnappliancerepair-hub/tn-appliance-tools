// markets-report — "who's finding us, who's clicking us, and where the opportunities
// are." Pulls Google Search Console (impressions = finding us, clicks = clicking us)
// + Google Ads performance (the paid tests), highlights which NEW-market pages
// (/repair/, /es/, /fix/) are waking up, and surfaces striking-distance opportunities
// (page-2 keywords one nudge from page 1). Owner-gated. Also runs weekly and texts Teddy.
//
//   GET ?secret=<admin>            JSON
//        &days=7|28                lookback (default 7)
//        &format=html              readable page
//        &text=1                   also text the owner the digest
//   (scheduled weekly Monday)      texts the owner automatically
'use strict';
const { getSecret } = require('./_lib/secrets');
const gsc = require('./_lib/search-console');
const ads = require('./_lib/google-ads');
const { sendSms } = require('./_lib/sms');

const OWNER = '+16154855795';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function html(c, s) { return { statusCode: c, headers: { 'content-type': 'text/html; charset=utf-8' }, body: s }; }
const NEW_MARKET = ['/repair/', '/es/', '/fix/'];
function isNewMarket(p) { return NEW_MARKET.some((x) => p.includes(x)); }
function cityFromPath(p) { return (p.replace('https://tnapplianceexchange.net', '').replace(/^\/(repair|es\/diagnostico|es\/reparacion)\//, '').replace(/\.html$/, '').replace(/-/g, ' ')) || p; }

async function adsPerf(days) {
  const c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return { ok: false, configured: false };
  let token; try { token = await ads.accessToken(c); } catch (e) { return { ok: false, error: String(e.message || e) }; }
  const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const range = days <= 7 ? 'LAST_7_DAYS' : 'LAST_30_DAYS';
  const gaql = `SELECT campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING ${range} AND campaign.status != 'REMOVED'`;
  const url = `https://googleads.googleapis.com/${c.version}/customers/${cid}/googleAds:search`;
  let r, d;
  try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body: JSON.stringify({ query: gaql }) }); d = await r.json().catch(() => ({})); }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
  if (!r.ok && r.status === 403 && c.managerId) { try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body: JSON.stringify({ query: gaql }) }); d = await r.json().catch(() => ({})); } catch (_) {} }
  if (!r.ok) return { ok: false, error: (d.error && d.error.message) || d };
  const rows = (d.results || []).map((x) => ({ name: x.campaign.name, status: x.campaign.status, impressions: Number(x.metrics.impressions || 0), clicks: Number(x.metrics.clicks || 0), cost: Math.round(Number(x.metrics.costMicros || 0) / 10000) / 100, conversions: Number(x.metrics.conversions || 0) }))
    .filter((x) => x.impressions || x.clicks || x.cost).sort((a, b) => b.clicks - a.clicks);
  return { ok: true, campaigns: rows };
}

// Quick Check conversions (the paid $50/$100 intakes) in the window, grouped by city.
// This is the money — and it funds the ads: each $50 Quick Check ≈ 5 more days at $10/day.
async function quickChecks(days) {
  const crud = require('./_lib/xano/metadata-crud');
  let rows;
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action: 'quick_check_paid' }, { created_at: 'desc' }, 400); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  const cutoff = Date.now() - days * 86400000;
  const meta = (r) => { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; };
  // Exclude owner/internal test purchases + $1 test-token runs so the "sales prove the
  // funnel" number is honest — a real stranger's first order should stand out. (2026-07-27)
  const OWNER_PHONES = new Set(['6154855795', '6154850713']); // Teddy, Danielle
  const dig = (p) => String(p || '').replace(/\D/g, '').slice(-10);
  const recent = (rows || []).map(meta).filter((m) => {
    if ((m.at_ms || 0) < cutoff) return false;
    if (String(m.is_test) === 'yes') return false;   // $1 test token
    if (Number(m.amount || 0) < 5) return false;      // $1 test purchases
    if (OWNER_PHONES.has(dig(m.phone))) return false; // owner's own test buys
    return true;
  });
  const byCity = {};
  const byOrg = {};
  let total = 0, dollars = 0, giftCount = 0, giftCents = 0;
  for (const m of recent) {
    total++; dollars += Number(m.amount || 0);
    const city = (m.town || m.city || 'Unknown') + (m.language && m.language !== 'en' ? ' 🌐' : '');
    if (!byCity[city]) byCity[city] = { city, count: 0, dollars: 0 };
    byCity[city].count++; byCity[city].dollars += Number(m.amount || 0);
    // 🎁 Anthony's Gift — families helped through a church/community-partner code
    const give = Number(m.giving_cents || 0);
    if (give > 0) {
      giftCount++; giftCents += give;
      const org = String(m.church_code || m.partner_code || 'Unknown');
      if (!byOrg[org]) byOrg[org] = { org, count: 0, dollars: 0, kind: m.church_code ? 'church' : 'partner' };
      byOrg[org].count++; byOrg[org].dollars += give / 100;
    }
  }
  const cities = Object.values(byCity).sort((a, b) => b.count - a.count);
  const orgs = Object.values(byOrg).sort((a, b) => b.count - a.count);
  const giving = { count: giftCount, dollars: Math.round(giftCents / 100), orgs };
  return { ok: true, total, dollars, cities, giving, ad_days_funded_at_10: Math.floor(dollars / 10) };
}

async function build(days) {
  const [qr, pr, ad, qc] = await Promise.all([
    gsc.query({ days, dimensions: ['query'], rowLimit: 1000 }).catch((e) => ({ ok: false, error: String(e) })),
    gsc.query({ days, dimensions: ['page'], rowLimit: 1000 }).catch((e) => ({ ok: false, error: String(e) })),
    adsPerf(days),
    quickChecks(days),
  ]);
  const out = { ok: true, days, generated_for: 'owner' };
  out.quick_checks = qc;

  if (qr && qr.ok) {
    const rows = qr.rows.map((r) => ({ query: r.keys[0], impressions: r.impressions, clicks: r.clicks, position: Math.round(r.position * 10) / 10 }));
    out.top_finding = rows.slice().sort((a, b) => b.impressions - a.impressions).slice(0, 15);
    out.top_clicking = rows.filter((r) => r.clicks > 0).sort((a, b) => b.clicks - a.clicks).slice(0, 15);
    out.opportunities = rows.filter((r) => r.position >= 4.5 && r.position <= 20 && r.impressions >= 10 && r.clicks <= 2).sort((a, b) => b.impressions - a.impressions).slice(0, 15);
  } else out.gsc_error = (qr && qr.error) || 'gsc unavailable';

  if (pr && pr.ok) {
    const pages = pr.rows.map((r) => ({ page: r.keys[0].replace('https://tnapplianceexchange.net', ''), impressions: r.impressions, clicks: r.clicks, position: Math.round(r.position * 10) / 10 }));
    out.new_market_pages = pages.filter((p) => isNewMarket(p.page) && p.impressions > 0).sort((a, b) => b.impressions - a.impressions).slice(0, 25);
    out.new_market_total_impressions = out.new_market_pages.reduce((s, p) => s + p.impressions, 0);
  }
  out.ads = ad;
  return out;
}

function digest(o) {
  const L = [];
  L.push(`🐜 Ant markets — last ${o.days}d`);
  if (o.quick_checks && o.quick_checks.ok) {
    const q = o.quick_checks;
    L.push(`💰 ${q.total} Quick Check${q.total === 1 ? '' : 's'} · $${q.dollars} → funds ${q.ad_days_funded_at_10} days of ads`);
    if (q.cities.length) L.push(`   ${q.cities.slice(0, 4).map((c) => `${c.city} (${c.count})`).join(', ')}`);
    if (q.giving && q.giving.count) {
      L.push(`🎁 Anthony's Gift: ${q.giving.count} famil${q.giving.count === 1 ? 'y' : 'ies'} helped · $${q.giving.dollars} given · ${q.giving.orgs.length} org${q.giving.orgs.length === 1 ? '' : 's'}`);
      if (q.giving.orgs.length) L.push(`   ${q.giving.orgs.slice(0, 4).map((o) => `${o.org} (${o.count})`).join(', ')}`);
    }
  }
  if (o.top_finding && o.top_finding.length) {
    const fi = o.top_finding.reduce((s, r) => s + r.impressions, 0);
    const cl = (o.top_clicking || []).reduce((s, r) => s + r.clicks, 0);
    L.push(`👀 Found ${fi.toLocaleString()}× · 🖱️ ${cl} clicks`);
    L.push(`Top: ${o.top_finding.slice(0, 3).map((r) => r.query).join(' · ')}`);
  }
  if (o.new_market_pages && o.new_market_pages.length) {
    L.push(`🌎 New-market pages getting found: ${o.new_market_pages.length} (${o.new_market_total_impressions.toLocaleString()} impr)`);
    L.push(`Waking up: ${o.new_market_pages.slice(0, 3).map((p) => p.page).join(' · ')}`);
  } else if (o.new_market_pages) {
    L.push('🌎 New-market pages: none indexed yet (still fresh — give it days)');
  }
  if (o.ads && o.ads.ok && o.ads.campaigns.length) {
    for (const c of o.ads.campaigns) L.push(`💵 ${c.name.slice(0, 32)}: ${c.clicks} clicks, $${c.cost}${c.conversions ? `, ${c.conversions} conv` : ''}`);
  }
  if (o.opportunities && o.opportunities.length) {
    L.push(`🎯 ${o.opportunities.length} page-2 opportunities. Top: "${o.opportunities[0].query}" (pos ${o.opportunities[0].position}, ${o.opportunities[0].impressions} impr)`);
  }
  L.push('Full report: tnapplianceexchange.net/.netlify/functions/markets-report?secret=…&format=html');
  return L.join('\n');
}

function page(o) {
  const tbl = (rows, cols) => `<table><tr>${cols.map((c) => `<th>${c[0]}</th>`).join('')}</tr>${rows.map((r) => `<tr>${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}</tr>`).join('')}</table>`;
  const n = (v) => (v || 0).toLocaleString();
  let s = `<!doctype html><meta charset=utf-8><title>Ant Markets Report</title><style>body{font-family:system-ui;background:#0b0b0c;color:#eee;padding:22px;max-width:900px;margin:0 auto}h1{font-size:22px}h2{font-size:16px;color:#ff8c42;margin-top:28px}table{border-collapse:collapse;width:100%;font-size:13.5px;margin-top:8px}th,td{padding:7px 9px;border-bottom:1px solid #2a2a2a;text-align:left}th{color:#8a8a8a;font-weight:600}.n{color:#8a8a8a;font-size:13px}</style>`;
  s += `<h1>🐜 Markets Report — last ${o.days} days</h1>`;
  if (o.quick_checks && o.quick_checks.ok) {
    const q = o.quick_checks;
    s += `<h2>💰 Quick Checks (the money — and it funds the ads)</h2>`;
    s += `<p class=n><b style="color:#39ff14;font-size:18px">${q.total} paid · $${q.dollars}</b> — that funds <b>${q.ad_days_funded_at_10} days</b> of ads at $10/day. Get 2, run $100. Get 4, run $200.</p>`;
    if (q.cities.length) s += tbl(q.cities, [['City', (r) => r.city], ['Quick Checks', (r) => r.count], ['$', (r) => '$' + r.dollars]]);
    else s += `<p class=n>No paid Quick Checks yet in this window. First one closes the loop.</p>`;
    if (q.giving) {
      s += `<h2>🎁 Anthony's Gift (families helped through churches + community partners)</h2>`;
      if (q.giving.count) {
        s += `<p class=n><b style="color:#39ff14;font-size:18px">${q.giving.count} famil${q.giving.count === 1 ? 'y' : 'ies'} helped · $${q.giving.dollars} given</b> across ${q.giving.orgs.length} org${q.giving.orgs.length === 1 ? '' : 's'}. <i>(Keep this for the CPA — it documents the giving.)</i></p>`;
        s += tbl(q.giving.orgs, [['Organization', (r) => r.org], ['Type', (r) => r.kind], ['Families', (r) => r.count], ['Given', (r) => '$' + r.dollars]]);
      } else s += `<p class=n>No gift discounts used yet in this window. Once churches + community partners share their links, this fills in.</p>`;
    }
  }
  if (o.ads && o.ads.ok && o.ads.campaigns.length) { s += `<h2>💵 Paid tests</h2>` + tbl(o.ads.campaigns, [['Campaign', (r) => r.name], ['Status', (r) => r.status], ['Impr', (r) => n(r.impressions)], ['Clicks', (r) => r.clicks], ['Cost', (r) => '$' + r.cost], ['Conv', (r) => r.conversions]]); }
  if (o.new_market_pages) { s += `<h2>🌎 New-market pages getting found (${n(o.new_market_total_impressions)} impressions)</h2>`; s += o.new_market_pages.length ? tbl(o.new_market_pages, [['Page', (r) => r.page], ['Impr', (r) => n(r.impressions)], ['Clicks', (r) => r.clicks], ['Pos', (r) => r.position]]) : '<p class=n>None indexed yet — the pages are fresh. Google usually takes days to weeks.</p>'; }
  if (o.top_finding) s += `<h2>👀 Who's finding us (top searches)</h2>` + tbl(o.top_finding, [['Search', (r) => r.query], ['Impr', (r) => n(r.impressions)], ['Clicks', (r) => r.clicks], ['Pos', (r) => r.position]]);
  if (o.top_clicking) s += `<h2>🖱️ Who's clicking us</h2>` + tbl(o.top_clicking, [['Search', (r) => r.query], ['Clicks', (r) => r.clicks], ['Impr', (r) => n(r.impressions)], ['Pos', (r) => r.position]]);
  if (o.opportunities) s += `<h2>🎯 Opportunities (page-2, one nudge from page 1)</h2>` + tbl(o.opportunities, [['Search', (r) => r.query], ['Pos', (r) => r.position], ['Impr', (r) => n(r.impressions)], ['Clicks', (r) => r.clicks]]);
  if (o.gsc_error) s += `<p class=n>Search Console: ${o.gsc_error}</p>`;
  return s;
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const days = Math.max(1, Math.min(90, parseInt(q.days, 10) || 7));
  const o = await build(days);

  if (scheduled || q.text === '1') {
    try { await sendSms(OWNER, digest(o), 'owner', 'markets_report'); o.texted = true; } catch (e) { o.text_error = String((e && e.message) || e); }
  }
  if (q.format === 'html') return html(200, page(o));
  return json(200, o);
};
