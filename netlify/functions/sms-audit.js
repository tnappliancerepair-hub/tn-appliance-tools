// sms-audit — read-only Telnyx messaging cost auditor. Pulls Telnyx Detail Records
// (the carrier's own billed records — the only true source, since internal office
// texts bypass our event_log markers) and buckets outbound SMS by WHO we texted:
// the office people (Danielle / Sofia / Carrie), techs, or customers. Answers
// "where is the Telnyx text spend going" and "how much would cutting the office
// flood save". Owner-gated, non-destructive. ?days=14 &debug=1 (dump 1 raw record).
'use strict';
const { getSecret } = require('./_lib/secrets');
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
exports.config = { timeout: 26 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Known internal recipients (our own people), so we can separate the office flood
// from real customer/tech texts. E.164, last-10 matched so format never bites.
const PEOPLE = {
  danielle: '6154850713',
  sofia: '6292594602',
  carrie: '2258035669',
  teddy: '6154855795',
};
// Our own SENDING numbers / tech cells (so tech-direction + our lines don't count as "customers").
const TECHS = { jimmy: '6159671304', andre: '5049099413', lee: '6158291654', john: '8133527686' };

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function last10(s) { return String(s || '').replace(/\D/g, '').slice(-10); }
function whoIs(num) {
  const t = last10(num);
  for (const [name, n] of Object.entries(PEOPLE)) if (last10(n) === t) return { bucket: 'office', who: name };
  for (const [name, n] of Object.entries(TECHS)) if (last10(n) === t) return { bucket: 'tech', who: name };
  return { bucket: 'customer', who: t || 'unknown' };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });
  const key = await getSecret('TELNYX_API_KEY');
  if (!key) return json(500, { ok: false, error: 'no_telnyx_key' });

  // record_type: Telnyx has NO "voice" type. Ann's cost lives in TWO record types —
  //   call-control       = the phone call legs (minutes)
  //   ai-voice-assistant = Ann's AI usage (STT + LLM + TTS) — the pricey part
  // Pass ?record_type= explicitly, or a friendly ?kind=. Default messaging.
  const KIND_MAP = {
    messaging: 'messaging', sms: 'messaging',
    voice: 'call-control', call: 'call-control', calls: 'call-control', 'call-control': 'call-control',
    ai: 'ai-voice-assistant', assistant: 'ai-voice-assistant', ann: 'ai-voice-assistant', 'ai-voice-assistant': 'ai-voice-assistant',
  };
  const recordType = String(q.record_type || KIND_MAP[String(q.kind || '').toLowerCase()] || 'messaging');
  const kind = recordType === 'messaging' ? 'messaging' : 'voice'; // 'voice' flags call/AI aggregation (minutes + billed cost)
  const days = Math.min(90, Math.max(1, Number(q.days || 14)));
  const now = Date.now();
  const gte = new Date(now - days * 86400e3).toISOString();
  const lte = new Date(now).toISOString();
  const H = { Authorization: 'Bearer ' + key, Accept: 'application/json' };

  // Pull Telnyx Detail Records (messaging). Telnyx clamps page size (~50), so drive
  // pagination off the response meta, not a client page size.
  const perPage = 50;
  const maxPages = Math.min(400, Number(q.max_pages || 300));
  let page = 1, sample = null, pulled = 0, metaSeen = null, limited = null;
  const byDest = {};        // last10 -> { count, parts, cost, inbound, outbound, who, bucket }
  const byDay = {};         // YYYY-MM-DD -> { count, cost }
  const buckets = { office: { count: 0, cost: 0 }, tech: { count: 0, cost: 0 }, customer: { count: 0, cost: 0 } };
  const recentOffice = [];  // office-directed outbound, for the kill proof
  const people = {};        // per office/tech person -> { count, cost }
  let totalCost = 0, totalOut = 0, totalIn = 0, totalSec = 0;

  try {
    while (page <= maxPages) {
      const url = 'https://api.telnyx.com/v2/detail_records'
        + '?filter[record_type]=' + recordType
        + '&filter[created_at][gte]=' + encodeURIComponent(gte)
        + '&filter[created_at][lte]=' + encodeURIComponent(lte)
        + '&page[number]=' + page + '&page[size]=' + perPage;
      let r = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000) });
      // Telnyx detail_records is rate-limited; back off + retry on 429.
      let tries = 0;
      while (r.status === 429 && tries < 4) { await sleep(1200 * (tries + 1)); r = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000) }); tries++; }
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        if (pulled === 0) return json(200, { ok: false, error: 'telnyx_' + r.status, detail: txt.slice(0, 400), pulled, note: 'Telnyx rejected/limited before any data — retry with fewer &days.' });
        limited = 'telnyx_' + r.status; break; // use the partial aggregate we already have
      }
      const j = await r.json().catch(() => ({}));
      const rows = Array.isArray(j.data) ? j.data : [];
      metaSeen = j.meta || metaSeen;
      if (!sample && rows[0]) sample = rows[0];
      if (!rows.length) break;

      for (const rec of rows) {
        pulled++;
        const dir = String(rec.direction || rec.messaging_direction || '').toLowerCase();
        const outbound = dir.includes('out') || dir === 'outbound';
        // cost: Telnyx MDR = per-message cost (string) + separate carrier_fee (string)
        const base = Number(
          (typeof rec.cost === 'string' ? rec.cost : (rec.cost && rec.cost.amount))
          || rec.total_cost || rec.billed_amount || rec.rate || 0
        ) || 0;
        const cfee = Number(rec.carrier_fee || 0) || 0;
        const cost = base + cfee;
        const parts = Number(rec.parts || rec.number_of_segments || rec.count || 1) || 1;
        const sec = kind === 'voice'
          ? (Number(rec.billed_sec || rec.duration_sec || rec.duration_seconds || rec.call_sec || rec.duration || 0) || 0)
            || (Number(rec.duration_millis || rec.billed_ms || 0) / 1000 || 0)
          : 0;
        totalSec += sec;
        const dest = outbound ? (rec.to || rec.cld || rec.destination) : (rec.from || rec.cli || rec.source);
        const t = last10(dest);
        const info = whoIs(dest);
        totalCost += cost;
        if (outbound) totalOut++; else totalIn++;

        // day trend (outbound only — that's the spend)
        if (outbound) {
          const d = (rec.created_at || rec.completed_at || lte).slice(0, 10);
          byDay[d] = byDay[d] || { count: 0, cost: 0 };
          byDay[d].count++; byDay[d].cost += cost;
        }

        // recent office-directed outbound list (proof of the kill: see them stop at deploy time)
        if (outbound && info.bucket === 'office') recentOffice.push({ to: info.who, at: rec.created_at || rec.completed_at || '', parts });

        const b = byDest[t] || (byDest[t] = { who: info.who, bucket: info.bucket, count: 0, parts: 0, cost: 0, inbound: 0, outbound: 0 });
        b.count++; b.parts += parts; b.cost += cost;
        if (outbound) b.outbound++; else b.inbound++;

        if (outbound) {
          buckets[info.bucket].count++; buckets[info.bucket].cost += cost;
          if (info.bucket !== 'customer') {
            const p = people[info.who] || (people[info.who] = { bucket: info.bucket, count: 0, cost: 0 });
            p.count++; p.cost += cost;
          }
        }
      }
      if (rows.length < perPage) break;
      page++;
      await sleep(180); // pace against Telnyx rate limit
    }
  } catch (e) {
    return json(200, { ok: false, error: 'pull_failed', detail: String(e && e.message || e), pulled });
  }

  if (q.debug) return json(200, { ok: true, sample, pulled, meta: metaSeen, note: 'raw first record — use to confirm field names' });

  const round = (n) => Math.round(n * 100) / 100;
  const topDest = Object.entries(byDest)
    .map(([t, v]) => ({ number: t, ...v, cost: round(v.cost) }))
    .sort((a, b) => b.outbound - a.outbound).slice(0, 25);
  const trend = Object.entries(byDay).map(([d, v]) => ({ day: d, count: v.count, cost: round(v.cost) })).sort((a, b) => a.day.localeCompare(b.day));
  const peopleOut = Object.entries(people).map(([who, v]) => ({ who, bucket: v.bucket, count: v.count, cost: round(v.cost) })).sort((a, b) => b.count - a.count);

  const officeShare = totalOut ? Math.round(buckets.office.count / totalOut * 100) : 0;
  const recentOfficeSorted = recentOffice.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 40);

  return json(200, {
    ok: true, kind, record_type: recordType, partial: !!limited, limited_by: limited,
    window_days: days, records_pulled: pulled,
    outbound_total: totalOut, inbound_total: totalIn,
    ...(kind === 'voice' ? { total_minutes: Math.round(totalSec / 60), billed_cost: round(totalCost) } : {}),
    est_total_cost: round(totalCost),
    outbound_by_bucket: {
      office: { count: buckets.office.count, cost: round(buckets.office.cost), pct_of_outbound: officeShare },
      tech: { count: buckets.tech.count, cost: round(buckets.tech.cost) },
      customer: { count: buckets.customer.count, cost: round(buckets.customer.cost) },
    },
    office_people: peopleOut,
    recent_office_texts: recentOfficeSorted,
    top_destinations: topDest,
    daily_trend: trend,
    read_me: 'office = texts to Danielle/Sofia/Carrie/Teddy (internal). A high office pct = the flood. Cost fields best-effort from Telnyx MDR; counts are exact.',
  });
};
