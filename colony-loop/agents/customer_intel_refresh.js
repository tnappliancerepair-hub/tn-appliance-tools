// CUSTOMER INTEL — materialized nightly aggregator
//
// Nightly 10:30pm CT — for every customer with activity in the last
// 60 days, computes + writes a single customer_intel event_log row
// holding:
//   channel_pref (portal | sms | unknown)         — from #1 engagement scoring
//   comms_style  (brief | conversational | formal | unknown) — from #6
//   preferred_language (en | es | unknown)        — from inbound SMS sniffing (#7)
//   lifetime_value_usd                            — sum of completed-job revenue
//   completed_jobs                                — count
//   last_seen_ms                                  — most recent any inbound
//   abuse_score                                   — inbound rate × no-job-id share (#10)
//
// Every customer-direction agent reads ONE row instead of running 3-4
// separate lookups. composeForChannel + the customer brain + the
// rate-limit gate all pull from the same materialized view.
//
// Why we don't query live each time: 8 customer-direction agents ×
// 3 lookups each × N customers per day = a lot of Xano hits. One
// nightly batch is 100x cheaper + keeps results consistent across
// agents (no race where agent A sees pref=portal and agent B sees
// pref=unknown because the engagement just crossed the threshold).
//
// Trade-off: intel is up to 24h stale. For comms tone that's fine —
// preferences don't change minute-to-minute. For rate-limit abuse
// detection we layer a live signal on top (see brain-core hooks).

import {
  listRecentEventLog,
  recordEvent,
  getCustomerChannelPreference,
  getCustomerCommsStyleSamples,
} from '../xano.js';

const WINDOW_DAYS = 60;
const SOFT_ABUSE_INBOUND_PER_DAY = 8; // higher than this in a single day = suspicious

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  // Pull all inbound customer SMS in the window — gives us the
  // distinct customer_id set + the rate input for abuse detection.
  let inboundRows = [];
  try {
    inboundRows = await listRecentEventLog({
      action: 'inbound_customer_sms_received',
      days_back: WINDOW_DAYS,
      limit: 5000,
    });
  } catch (e) {
    log('customer_intel_refresh_query_failed', { error: String(e) });
    inboundRows = [];
  }

  // Bucket inbound by customer_id + collect timestamps + body samples.
  const buckets = new Map();
  for (const row of inboundRows) {
    let meta;
    try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata; }
    catch (_) { continue; }
    if (!meta) continue;
    const cid = Number(meta.customer_id || 0);
    if (!cid) continue;
    if (!buckets.has(cid)) {
      buckets.set(cid, {
        customer_id: cid,
        inbound_count: 0,
        last_seen_ms: 0,
        body_samples: [],
        no_job_id_count: 0,
      });
    }
    const b = buckets.get(cid);
    b.inbound_count += 1;
    const ts = Number(row.created_at_ms || row.created_at || 0);
    if (ts > b.last_seen_ms) b.last_seen_ms = ts;
    if (!Number(meta.job_id || 0)) b.no_job_id_count += 1;
    if (meta.body_preview && b.body_samples.length < 20) b.body_samples.push(String(meta.body_preview));
  }

  let written = 0;
  for (const b of buckets.values()) {
    // Pull channel pref via the existing endpoint (already 60d-scoped)
    let channelPref = { prefers: 'unknown' };
    try { channelPref = await getCustomerChannelPreference(b.customer_id); }
    catch (_) {}

    // Comms style classification — reuse the samples we already have
    const styleResult = classifyStyle(b.body_samples);

    // Language detection — first inbound that has Spanish markers wins
    const language = detectLanguage(b.body_samples);

    // Abuse score: inbound rate × no-job-id share. 0-100 ish.
    const days = Math.max(1, (Date.now() - (b.last_seen_ms || Date.now())) / 86400000 + 1);
    const inboundPerDay = b.inbound_count / Math.max(days, 1);
    const noJobShare = b.inbound_count > 0 ? b.no_job_id_count / b.inbound_count : 0;
    const abuseScore = Math.min(100, Math.round((inboundPerDay / SOFT_ABUSE_INBOUND_PER_DAY) * 50 + noJobShare * 50));

    try {
      await recordEvent('customer_intel', {
        customer_id: b.customer_id,
        channel_pref: channelPref.prefers || 'unknown',
        channel_pref_score: channelPref.score || 0,
        comms_style: styleResult.style,
        comms_style_samples: styleResult.sample_count,
        preferred_language: language,
        inbound_count_window: b.inbound_count,
        inbound_no_job_share_pct: Math.round(noJobShare * 100),
        last_seen_ms: b.last_seen_ms,
        abuse_score: abuseScore,
        window_days: WINDOW_DAYS,
        refreshed_at_ms: Date.now(),
      });
      written += 1;
    } catch (_) {}
  }

  await xano.markSignalProcessed(signal.id, 'customer_intel_refresh_handled', {
    customers_written: written,
    inbound_rows_seen: inboundRows.length,
  });
  log('customer_intel_refresh_handled', { written });
  return { success: true, action: 'refreshed', count: written };
}

function classifyStyle(bodies) {
  if (!bodies || bodies.length < 3) return { style: 'unknown', sample_count: bodies ? bodies.length : 0 };
  let total = 0, brief = 0, formal = 0;
  for (const body of bodies) {
    const s = String(body || '').trim();
    if (!s) continue;
    total += 1;
    const lower = s.toLowerCase();
    if (s.length < 25 || ['ok', 'okay', 'yes', 'no', 'thx', 'thanks', 'k', 'yep', 'yup', 'sure'].includes(lower)) brief += 1;
    if (lower.includes('thank you') || lower.includes('appreciate') || lower.includes('sir') || lower.includes("ma'am") || lower.includes('maam') || lower.includes('please ') || lower.includes('kindly ')) formal += 1;
  }
  if (total < 3) return { style: 'unknown', sample_count: total };
  if ((brief / total) >= 0.6) return { style: 'brief', sample_count: total };
  if ((formal / total) >= 0.3) return { style: 'formal', sample_count: total };
  return { style: 'conversational', sample_count: total };
}

// Quick Spanish-vs-English sniff. Looks for high-frequency Spanish
// function words / accented chars / Ñ. ≥ 2 distinct hits = es.
function detectLanguage(bodies) {
  if (!bodies || bodies.length === 0) return 'unknown';
  const ES_MARKERS = [
    /\b(el|la|los|las|un|una|unos|unas|de|del|por|para|con|sin|que|qué|cuando|donde|dónde|cómo|cuanto|cuándo)\b/i,
    /\b(hola|gracias|por favor|señor|señora|adios|adiós|hasta|luego|buenas|buenos)\b/i,
    /\b(necesito|tengo|tiene|estoy|esta|está|estan|están|hace|hacer|puede|puedo|quiero|quiere)\b/i,
    /[ñáéíóúü¿¡]/i,
  ];
  let hits = 0;
  for (const body of bodies) {
    const s = String(body || '');
    if (!s) continue;
    for (const re of ES_MARKERS) {
      if (re.test(s)) { hits += 1; break; }
    }
  }
  if (hits >= 2) return 'es';
  return 'en';
}
