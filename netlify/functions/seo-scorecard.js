// seo-scorecard — the DAILY improvement engine for the lead machine (Teddy 2026-08-17:
// "make it better daily to get it to its potential"). Same flywheel as the knowledge
// scorecard, pointed at SEO: measure the machine, find the single highest-value lever
// to pull today, log it to a gap ledger so recurring opportunities rise, and text the
// owner ONE actionable thing. Getting-to-potential becomes a number that climbs + a
// 5-second decision, not a vibe.
//
// Reads (all from Xano event_log, no auth): gsc_snapshot (vitals + the top query rows,
// refreshed weekly) and lead_attribution (DIY /fix conversions, daily). Ranks levers:
//   • striking-distance — a term at position ~4-15 that's one nudge from page 1 (cheapest win)
//   • content gap — a term getting impressions but ranked deep with zero clicks (needs a page)
// The day's #1 lever = the highest-value one not surfaced in the last few days (so each
// day is fresh, not repeat spam), logged as a seo_gap so the ledger tracks it.
//
//   GET ?secret=<admin>          compute + store + return JSON (pull anytime)
//   GET ?secret=<admin>&text=1   also text the owner the day's lever
//   (the daily cron wrapper fires this with text=1)
'use strict';
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');

const OWNER = '+16154855795';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function tsOf(r) { return Number(metaOf(r).at_ms) || Date.parse(r && r.created_at) || 0; }
const arrow = (d) => (d == null ? '' : d > 0 ? ' ▲+' + d : d < 0 ? ' ▼' + d : ' ±0');
async function getJSON(url, ms) { try { const r = await fetch(url, { signal: AbortSignal.timeout(ms || 9000) }); return await r.json(); } catch (_) { return null; } }
async function rows(action, days, limit) { const d = await getJSON(`${XANO}/list_recent_event_log?action=${action}&days_back=${days}&limit=${limit}`, 9000); const its = (d && (d.items || d)) || []; return Array.isArray(its) ? its : []; }

// Rank the highest-value SEO levers from the tracked query rows ({c:clicks,i:impr,p:pos,q}).
function buildLevers(qrows) {
  const out = [];
  for (const r of qrows) {
    const p = Number(r.p) || 99, i = Number(r.i) || 0, c = Number(r.c) || 0, q = String(r.q || '').trim();
    if (!q || i < 12) continue;
    if (p >= 4 && p <= 15 && c <= 1) {
      out.push({ key: q.toLowerCase(), type: 'striking', q, p: Math.round(p), i, score: i * 1.6, text: `You're #${Math.round(p)} for "${q}" (${i} searches/wk) — one nudge from page 1. Strengthen that page + push reviews naming the city.` });
    } else if (p > 15 && c === 0 && i >= 25) {
      out.push({ key: q.toLowerCase(), type: 'content_gap', q, p: Math.round(p), i, score: i, text: `"${q}" — ${i} searches, ranked #${Math.round(p)}, zero clicks. Build or beef up a dedicated page for it.` });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const doText = q.text === '1' || scheduled;

  // 1) Vitals from the two most-recent GSC snapshots (weekly cadence — the count line).
  const snaps = (await rows('gsc_snapshot', 30, 4)).sort((a, b) => tsOf(b) - tsOf(a));
  const cur = metaOf(snaps[0]) || {}; const prev = metaOf(snaps[1]) || {};
  const pg = cur.pages || {}; const ppg = prev.pages || {};
  const surfacing = pg.surfacing || 0, page1 = pg.page1 || 0, impressions = pg.impressions || 0;
  const dS = ppg.surfacing != null ? surfacing - ppg.surfacing : null;
  const dP = ppg.page1 != null ? page1 - ppg.page1 : null;

  // 2) DIY conversions (the whole point of the /fix machine) — last 7 days.
  const leads = await rows('lead_attribution', 7, 200);
  const diyConv = leads.filter((r) => { const m = metaOf(r); const s = ((m.landing || '') + ' ' + (m.ref || '') + ' ' + (m.channel || '')).toLowerCase(); return s.includes('/fix/') || s.includes('src=fix') || s.includes('=fix'); }).length;

  // 3) Rank levers; pick today's #1 as the top one NOT surfaced in the last 3 days.
  const levers = buildLevers(cur.rows || []);
  const recent = new Set((await rows('seo_gap', 4, 60)).map((r) => (metaOf(r).key || '')).filter(Boolean));
  const fresh = levers.filter((l) => !recent.has(l.key));
  const top = fresh[0] || levers[0] || null;

  // 4) Log the scorecard trend + the surfaced lever (the ledger).
  const today = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2');
  try { await crud.logEvent('seo_score', { date: today, surfacing, page1, impressions, d_surfacing: dS, d_page1: dP, diy_conv_7d: diyConv, levers_open: levers.length, top_key: top ? top.key : '', at_ms: Date.now() }); } catch (_) {}
  if (top) { try { await crud.logEvent('seo_gap', { key: top.key, type: top.type, q: top.q, position: top.p, impressions: top.i, at_ms: Date.now() }); } catch (_) {} }

  // 5) Text the owner one actionable line.
  let texted = false;
  if (doText) {
    const L = [`🔎 SEO machine — ${surfacing} pages on Google${arrow(dS)} · ${page1} on pg1${arrow(dP)} · ${impressions} impr/wk`];
    L.push(`DIY conversions: ${diyConv}/7d${diyConv === 0 ? ' (still warming — pages just went live)' : ''}`);
    if (top) { L.push(`🎯 Today's #1 lever: ${top.text}`); if (levers.length > 1) L.push(`${levers.length - 1} more queued.`); }
    else { L.push('🎯 No striking-distance gap today — keep publishing DIY content + pushing reviews.'); }
    L.push(`Pull full: ${BASE}/seo-scorecard?secret=…`);
    try { await sendSms(OWNER, L.join('\n'), 'owner', 'seo_scorecard'); texted = true; } catch (_) {}
  }

  return json(200, { ok: true, texted, vitals: { surfacing, page1, impressions, d_surfacing: dS, d_page1: dP }, diy_conv_7d: diyConv, top_lever: top, levers: levers.slice(0, 10) });
};
