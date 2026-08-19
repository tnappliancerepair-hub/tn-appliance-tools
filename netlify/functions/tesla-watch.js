// tesla-watch — durable, infra-owned watch for the two Tesla triggers Teddy cares
// about (2026-08-19): (1) Tesla opens CONSUMER Cybercab ordering/reservations to the
// public, and (2) Tesla's paid robotaxi network goes LIVE in Nashville / Middle TN.
// Runs on our own Netlify cron indefinitely (no session, no 7-day expiry — the reason
// this exists instead of a session cron), and TEXTS TEDDY only on a genuine new signal.
//
// Source = Google News RSS (server-fetchable, unlike Tesla.com/Amazon which anti-bot
// datacenter IPs). Two tight queries; each hit must match STRONG keywords so routine
// "Cybercab in production" chatter doesn't trip it. First run BASELINES silently (records
// today's matches without texting) so Teddy isn't spammed with already-known news; only
// NEW headlines after that fire. Dedups on title keys (event_log). Fresh = published in
// the last `days` (default 12) AND not seen before.
//
//   GET ?dryrun=1          -> matches + would-alert, texts nothing
//   GET ?secret=<admin>    -> live run (manual)
//   scheduled {next_run}   -> live run (self-authorizes)
//   Kill switch: vault TESLA_WATCH=off.   Reset baseline: ?reset=1&secret=<admin>.
'use strict';

const { sendSms } = require('./_lib/sms');
const { getSecret } = require('./_lib/secrets');

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG = 3;
const OWNER = '+16154855795';

// Two triggers, each: an RSS query + the strong keywords a headline must ALSO hit.
const WATCHES = [
  {
    key: 'cybercab_consumer_order',
    label: 'Cybercab consumer ordering',
    q: 'Tesla Cybercab reservations order buy for sale',
    must: /cybercab/i,
    // TRIGGER #1 = an individual can BUY/RESERVE one to OWN. Deliberately NOT "launch"/
    // "public"/"robotaxi" alone — that's the Austin robotaxi SERVICE launch (Tesla's own
    // fleet), a huge separate news wave. Require an actual purchase concept so this fires
    // only when consumer ordering genuinely opens.
    signal: /\b(reserv(e|es|ed|ation|ations)|pre-?order|for sale|on sale|goes? on sale|configurator|retail sale|consumer (sale|sales|order|ordering)|available to (buy|order|purchase|reserve|the public)|open(s|ed|ing)? (orders|reservations|for order)|order(s)? (open|now|live|book)|(buy|purchase|own) (a|your|one))\b/i,
  },
  {
    key: 'nashville_robotaxi',
    label: 'Nashville robotaxi launch',
    q: 'Tesla robotaxi Nashville Tennessee',
    must: /\b(nashville|middle tennessee|tennessee)\b/i,
    signal: /\brobotaxi/i,
  },
];

function hdr() { const t = process.env.XANO_METADATA_TOKEN; return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null; }
function decode(s) { return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim(); }
function keyOf(title) { return decode(title).toLowerCase().replace(/\s+-\s+[^-]+$/, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80); }

async function fetchFeed(q) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TN-Appliance-Watch/1.0)' }, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error('rss ' + r.status);
  const xml = await r.text();
  const items = [];
  for (const m of xml.match(/<item>[\s\S]*?<\/item>/g) || []) {
    const t = (m.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const link = (m.match(/<link>([\s\S]*?)<\/link>/) || [])[1];
    const pub = (m.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
    if (t) items.push({ title: decode(t), link: decode(link), pub_ms: pub ? (Date.parse(decode(pub)) || 0) : 0 });
  }
  return items;
}

// state in event_log: { keys: [...seen title keys], baselined: true }
async function loadState() {
  const h = hdr(); if (!h) return { keys: new Set(), baselined: false };
  try {
    const r = await fetch(`${META}/table/${EVENT_LOG}/content/search`, { method: 'POST', headers: h, body: JSON.stringify({ search: { action: 'tesla_watch_seen' }, sort: { id: 'desc' }, per_page: 1, page: 1 }) });
    const j = await r.json().catch(() => ({}));
    let m = ((j.items || [])[0] || {}).metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    return { keys: new Set((m && m.keys) || []), baselined: !!(m && m.baselined) };
  } catch (_) { return { keys: new Set(), baselined: false }; }
}
async function saveState(keys, baselined) {
  const h = hdr(); if (!h) return;
  try { await fetch(`${META}/table/${EVENT_LOG}/content`, { method: 'POST', headers: h, body: JSON.stringify({ action: 'tesla_watch_seen', metadata: { keys: [...keys].slice(-60), baselined, at_ms: Date.now() } }) }); } catch (_) {}
}

exports.config = { timeout: 20 };

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const dry = q.dryrun === '1';
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let scheduled = false; try { scheduled = !!JSON.parse((event && event.body) || '{}').next_run; } catch (_) {}
  if (!dry && !scheduled && q.secret !== admin) return { statusCode: 401, body: 'unauthorized — ?secret=' };

  if (String(await getSecret('TESLA_WATCH') || '').toLowerCase() === 'off') return { statusCode: 200, body: 'disabled' };

  const days = Math.max(1, Number(q.days || 12));
  const cutoff = Date.now() - days * 86400000;

  // gather qualifying, recent items across both watches
  const hits = [];
  for (const w of WATCHES) {
    let items = [];
    try { items = await fetchFeed(w.q); } catch (e) { continue; }
    for (const it of items) {
      if (!w.must.test(it.title) || !w.signal.test(it.title)) continue;
      if (it.pub_ms && it.pub_ms < cutoff) continue; // stale re-syndication
      hits.push({ ...it, watch: w.key, label: w.label, k: keyOf(it.title) });
    }
  }
  // newest first, dedup by title key within this run
  const byKey = new Map();
  for (const h of hits.sort((a, b) => (b.pub_ms || 0) - (a.pub_ms || 0))) if (!byKey.has(h.k)) byKey.set(h.k, h);
  const unique = [...byKey.values()];

  if (dry) return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, days, count: unique.length, hits: unique.map((h) => ({ label: h.label, title: h.title, when: h.pub_ms ? new Date(h.pub_ms).toISOString().slice(0, 10) : '?' })) }, null, 2) };

  const state = await loadState();
  if (q.reset === '1') { await saveState(new Set(), false); return { statusCode: 200, body: 'baseline reset' }; }

  // FIRST RUN: baseline silently so Teddy isn't spammed with today's already-known chatter.
  if (!state.baselined) {
    const keys = new Set(state.keys); unique.forEach((h) => keys.add(h.k));
    await saveState(keys, true);
    return { statusCode: 200, body: `baselined ${unique.length} existing item(s), texted nothing` };
  }

  const fresh = unique.filter((h) => !state.keys.has(h.k));
  if (!fresh.length) return { statusCode: 200, body: `no new tesla signal (${unique.length} known)` };

  // Text Teddy — one message, up to 3 headlines, newest first.
  const top = fresh[0];
  const lines = fresh.slice(0, 3).map((h) => `• [${h.label}] ${h.title.slice(0, 110)}\n  ${h.link}`).join('\n\n');
  const body = `[ant] 🚗 Tesla watch — possible new development:\n\n${lines}\n\n(Watching: consumer Cybercab ordering + Nashville robotaxi. Verify before acting — news can restate old info.)`;
  try { await sendSms(OWNER, body, 'owner', 'tesla_watch'); } catch (_) {}

  const keys = new Set(state.keys); fresh.forEach((h) => keys.add(h.k));
  await saveState(keys, true);
  return { statusCode: 200, body: `alerted ${fresh.length} new (top: ${top.title.slice(0, 60)})` };
};
