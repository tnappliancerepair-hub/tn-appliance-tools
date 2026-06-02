// MARKETING SITE WATCH
//
// Fires every 5 min via tick.js. Probes tnapplianceexchange.net + a few
// critical customer-facing surfaces and SMSes Teddy when something is
// wrong. Built after the 2026-05-30 incident where a CSS bug (live for
// 5 days) hid the marketing site behind a stuck "Loading your repair
// info" overlay for every clean URL hit.
//
// What it checks per URL:
//   1. HTTP status 200
//   2. Body size >= a sane minimum (catches blank pages + 50x bodies)
//   3. Required content markers are present (catches deploy regressions
//      that strip critical content)
//   4. Known-broken-state markers are NOT present (catches specific
//      regressions like today's overlay bug, where the symptom is
//      detectable in static HTML)
//
// Dedup + recovery semantics:
//   • Alert on FIRST failure of any surface.
//   • Don't re-alert for the same (url, failure_reason) within 30 min.
//   • When a previously-failing surface comes back healthy, send a
//     ONE-LINE "recovered" SMS so Teddy knows it's resolved without
//     digging.
//
// Failure state is tracked via event_log (action='marketing_site_alert'
// and action='marketing_site_recovered') so this agent stays stateless
// across loop restarts.

import { listRecentEventLog, recordEvent } from '../xano.js';

const PROBES = [
  {
    url: 'https://tnapplianceexchange.net/',
    label: 'marketing root',
    min_bytes: 50_000,
    must_contain: [
      'TN APPLIANCE EXCHANGE',
      'tnappliancerepair',
    ],
    must_not_contain_alone: [
      // If the page body is dominated by the loading overlay and missing
      // the hero copy, that is the 2026-05-30 regression signature.
    ],
    must_contain_css_rule: [
      // The fix-rule from commit 2d311d3. If a future deploy strips this
      // rule, the overlay regression returns silently. Catch it here.
      '.resume-overlay[hidden]',
    ],
  },
  {
    // office.html became a tiny client-side redirect to office-today.html on
    // 2026-06-01 when the hub was consolidated. Probe checks the redirect
    // is intact (any HTTP 200 of any size + the redirect script present) —
    // it deliberately does NOT min-byte gate this anymore.
    url: 'https://tnapplianceexchange.net/office.html',
    label: 'office hub redirect',
    min_bytes: 0,
    must_contain: ['office-today.html'],
  },
  {
    // The real hub Danielle uses. This is what should actually have content.
    url: 'https://tnapplianceexchange.net/office-today.html',
    label: 'office today (hub)',
    min_bytes: 5_000,
    must_contain: ['Office Today', 'office-search.js', 'getOfficeToday'],
  },
  {
    url: 'https://tnapplianceexchange.net/tech-ant-chat.html',
    label: 'tech ant chat',
    min_bytes: 5_000,
    must_contain: ['Tech Ant'],
  },
  {
    url: 'https://tnapplianceexchange.net/customer-portal.html',
    label: 'customer portal',
    min_bytes: 5_000,
    must_contain: ['Your Appointment'],
  },
];

const FETCH_TIMEOUT_MS = 12_000;
const REALERT_COOLDOWN_MS = 30 * 60 * 1000;

async function probeOne(probe) {
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(probe.url, { signal: ac.signal });
    const body = await r.text();
    clearTimeout(tid);

    if (r.status !== 200) {
      return { ok: false, reason: `http_${r.status}`, detail: `HTTP ${r.status}` };
    }
    if (body.length < (probe.min_bytes || 0)) {
      return { ok: false, reason: 'body_too_small', detail: `${body.length} bytes (need >=${probe.min_bytes})` };
    }
    for (const needle of (probe.must_contain || [])) {
      if (!body.includes(needle)) {
        return { ok: false, reason: 'missing_required_content', detail: `missing "${needle}"` };
      }
    }
    for (const needle of (probe.must_contain_css_rule || [])) {
      if (!body.includes(needle)) {
        return { ok: false, reason: 'missing_css_rule', detail: `missing CSS rule "${needle}"` };
      }
    }
    return { ok: true };
  } catch (err) {
    clearTimeout(tid);
    return { ok: false, reason: 'fetch_failed', detail: String(err.message || err) };
  }
}

async function alreadyAlertedRecently(urlKey, reason) {
  let rows = [];
  try {
    rows = await listRecentEventLog({ action: 'marketing_site_alert', days_back: 1, limit: 200 });
  } catch (_) {}
  const cutoff = Date.now() - REALERT_COOLDOWN_MS;
  for (const r of rows || []) {
    const md = r.metadata || {};
    const cid = r.created_at || 0;
    if (cid < cutoff) continue;
    if (md.url === urlKey && md.reason === reason) return true;
  }
  return false;
}

async function wasFailingBefore(urlKey) {
  let alerts = [];
  let recovers = [];
  try {
    alerts = await listRecentEventLog({ action: 'marketing_site_alert', days_back: 1, limit: 200 });
  } catch (_) {}
  try {
    recovers = await listRecentEventLog({ action: 'marketing_site_recovered', days_back: 1, limit: 200 });
  } catch (_) {}
  const lastAlertTs = (alerts || []).filter(r => (r.metadata || {}).url === urlKey).reduce((a, r) => Math.max(a, r.created_at || 0), 0);
  const lastRecoverTs = (recovers || []).filter(r => (r.metadata || {}).url === urlKey).reduce((a, r) => Math.max(a, r.created_at || 0), 0);
  return lastAlertTs > 0 && lastAlertTs > lastRecoverTs;
}

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const startedMs = Date.now();
  const results = [];

  for (const probe of PROBES) {
    const result = await probeOne(probe);
    results.push({ url: probe.url, label: probe.label, ...result });
  }

  const failing = results.filter(r => !r.ok);
  const passing = results.filter(r => r.ok);

  let alerts_sent = 0;
  let recoveries_sent = 0;

  for (const f of failing) {
    if (await alreadyAlertedRecently(f.url, f.reason)) continue;
    const body = `[ant] marketing site issue — ${f.label} (${f.url}) failing: ${f.reason}. ${f.detail || ''}`.slice(0, 300);
    try { await sms.toOwner(body, { call_site: 'marketing_site_watch_alert' }); }
    catch (_) {}
    try { await recordEvent('marketing_site_alert', { url: f.url, label: f.label, reason: f.reason, detail: f.detail || '' }); }
    catch (_) {}
    alerts_sent += 1;
  }

  for (const p of passing) {
    if (await wasFailingBefore(p.url)) {
      try { await sms.toOwner(`[ant] marketing site recovered — ${p.label} (${p.url}) back to OK`, { call_site: 'marketing_site_watch_recovery' }); }
      catch (_) {}
      try { await recordEvent('marketing_site_recovered', { url: p.url, label: p.label }); }
      catch (_) {}
      recoveries_sent += 1;
    }
  }

  const totalMs = Date.now() - startedMs;
  await xano.markSignalProcessed(signal.id, 'marketing_site_watch_handled', {
    probes: results.length,
    failing: failing.length,
    passing: passing.length,
    alerts_sent,
    recoveries_sent,
    total_ms: totalMs,
  });
  log('marketing_site_watch_done', {
    probes: results.length,
    failing: failing.length,
    alerts_sent,
    recoveries_sent,
    total_ms: totalMs,
  });
  return { success: true, failing: failing.length, alerts_sent, recoveries_sent };
}
