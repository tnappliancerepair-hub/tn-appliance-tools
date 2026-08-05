// returns.js — shared loader for OPEN parts-returns, enriched + deadline-stamped.
//
// The chargeback-protection backbone. Reads the data the SquareTrade RMA catcher
// already produces (parts_return_label events) and the office close action
// (warranty_part_status / returned), figures out which returns are still OPEN,
// attributes each to the tech who serviced the job, and stamps a deadline +
// days-left so the tech view and the reminder engine both speak "return by X".
//
// Deadline source is a PLACEHOLDER until Danielle confirms (see the questions doc):
// window = label-received date + RETURN_WINDOW_DAYS. Override via env/vault
// RETURN_WINDOW_DAYS. When she tells us the real rule (per-vendor, on the label,
// etc.) we change it here, one spot.
'use strict';
const crud = require('./xano/metadata-crud');

const INTAKE = (process.env.XANO_INTAKE_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA').replace(/\/+$/, '');
const DEFAULT_WINDOW_DAYS = 14; // ⚠ placeholder — confirm the real return window w/ Danielle

function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
const keyOf = (jobId, part) => `${jobId || 0}::${String(part || '').trim().toLowerCase()}`;

// Resolve a job's tech via the reliable read endpoint (filtering the jobs table by
// id through the metadata API is flaky; get_job_for_dashboard is purpose-built).
async function jobTech(jobId, cache) {
  if (!jobId) return null;
  if (cache && cache[jobId] !== undefined) return cache[jobId];
  let tech = null;
  try {
    const r = await fetch(`${INTAKE}/get_job_for_dashboard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job_id: jobId }), signal: AbortSignal.timeout(9000) });
    if (r.ok) { const d = await r.json(); const j = (d && d.job) || {}; tech = (j.technician_id != null ? Number(j.technician_id) : null) || (d && d.tech && Number(d.tech.id)) || null; }
  } catch (_) {}
  if (cache) cache[jobId] = tech;
  return tech;
}

// opts: { windowDays?, techId?, max?, resolveTech? (default true) }
async function loadOpenReturns(opts = {}) {
  const windowDays = Number(opts.windowDays) > 0 ? Number(opts.windowDays)
    : (Number(process.env.RETURN_WINDOW_DAYS) > 0 ? Number(process.env.RETURN_WINDOW_DAYS) : DEFAULT_WINDOW_DAYS);
  const max = opts.max || 400;

  // includePending (default true): also surface returns the TECH flagged Unused at the
  // stop even before an RMA label has emailed in — so the office starts the return from
  // the tech's real-time knowledge, not from waiting on an email. The reminder engine
  // passes includePending:false so it only escalates "ship it" on actually-printable
  // labels. (Teddy 2026-08-04: "the tech knows what he isn't using — simplify it.")
  const includePending = opts.includePending !== false;
  const [labels, statusRows, suppliedRows] = await Promise.all([
    crud.searchPage(crud.TABLES.event_log, { action: 'parts_return_label' }, { id: 'desc' }, max).catch(() => []),
    crud.searchPage(crud.TABLES.event_log, { action: 'warranty_part_status' }, { id: 'desc' }, max).catch(() => []),
    crud.searchPage(crud.TABLES.event_log, { action: 'warranty_part_supplied' }, { id: 'desc' }, max).catch(() => []),
  ]);

  // Latest tech/office status per (job, part) — newest wins.
  const latestStatus = {};
  for (const r of statusRows) { const m = metaOf(r); const k = keyOf(m.job_id, m.part); if (latestStatus[k]) continue; latestStatus[k] = { status: String(m.status || '').toLowerCase(), at_ms: Number(m.at_ms || r.created_at || 0) }; }
  // Closed = marked shipped/returned.
  const closed = new Set();
  for (const k of Object.keys(latestStatus)) { if (['returned', 'shipped'].includes(latestStatus[k].status)) closed.add(k); }
  // Supplied-part metadata (distributor/claim/customer/tracking) to enrich a
  // tech-flagged return that has no emailed label yet. Newest per (job, part).
  const suppliedMeta = {};
  for (const r of suppliedRows) { const m = metaOf(r); const k = keyOf(m.job_id, m.part); if (!suppliedMeta[k]) suppliedMeta[k] = m; }

  const seen = new Set(); const open = [];
  // (1) Emailed RMA labels — the return is ready to print.
  for (const r of labels) {
    const m = metaOf(r); const k = keyOf(m.job_id, m.part);
    if (seen.has(k)) continue; seen.add(k);
    if (closed.has(k)) continue;
    // Deadline priority: (1) an explicit due date parsed from the email (rare today),
    // (2) the email's ISSUE date + window (the real anchor — when the label was sent),
    // (3) last resort, when we scraped it. Per-email day-window override = due_days.
    const issuedMs = Number(m.issued_ms) || 0;
    const scrapeMs = Number(m.at_ms || r.created_at || 0);
    const days = Number(m.due_days) > 0 ? Number(m.due_days) : windowDays;
    const anchorMs = issuedMs || scrapeMs;
    const explicitDue = Number(m.due_ms) || 0;
    const dueMs = explicitDue || (anchorMs + days * 86400000);
    const source = explicitDue ? 'email_explicit' : (issuedMs ? 'email_issue_date+window' : 'scrape+window');
    open.push({
      key: k, job_id: m.job_id || null, part: m.part || '', rma: m.rma || '', tracking: m.tracking || '',
      distributor: m.distributor || '', customer: m.customer || '', return_desc: m.return_desc || '', claim: m.claim || '',
      email_id: m.email_id || '', // source RMA email → lets us pull the prepaid label PDF
      issued_ms: issuedMs || null, label_ms: anchorMs, due_ms: dueMs, deadline_source: source, deadline_text: m.deadline_text || '',
      has_label: true, label_pending: false, tech_confirmed: !!(latestStatus[k] && latestStatus[k].status === 'to_return'), status: 'ready',
    });
  }
  // (2) Tech flagged UNUSED at the stop, no label emailed yet → start the return NOW so
  // the office isn't blind until an email arrives. Enriched from the supplied-part record.
  if (includePending) {
    for (const k of Object.keys(latestStatus)) {
      if (latestStatus[k].status !== 'to_return') continue;
      if (seen.has(k) || closed.has(k)) continue;
      seen.add(k);
      const sm = suppliedMeta[k] || {};
      const jobId = Number(k.split('::')[0]) || (sm.job_id || null);
      const partName = sm.part || (k.split('::')[1] || '');
      const markMs = Number(latestStatus[k].at_ms) || Date.now();
      const dueMs = markMs + windowDays * 86400000;
      open.push({
        key: k, job_id: jobId, part: partName, rma: sm.rma || '', tracking: sm.tracking || '',
        distributor: sm.distributor || '', customer: sm.customer || '', return_desc: sm.return_desc || 'Unused — tech flagged at the stop', claim: sm.claim || '',
        email_id: '',
        issued_ms: null, label_ms: markMs, due_ms: dueMs, deadline_source: 'tech_flagged+window', deadline_text: '',
        has_label: false, label_pending: true, tech_confirmed: true, status: 'label_pending',
      });
    }
  }

  // attribute to tech (cached) unless caller opts out
  if (opts.resolveTech !== false) {
    const cache = {};
    for (const o of open) o.tech_id = await jobTech(o.job_id, cache);
  }

  let result = (opts.techId != null) ? open.filter((o) => Number(o.tech_id) === Number(opts.techId)) : open;
  const now = Date.now();
  for (const o of result) { o.days_left = Math.ceil((o.due_ms - now) / 86400000); o.overdue = o.due_ms < now; }
  result.sort((a, b) => a.due_ms - b.due_ms); // most urgent first
  return { window_days: windowDays, returns: result };
}

module.exports = { loadOpenReturns, jobTech, keyOf, metaOf, DEFAULT_WINDOW_DAYS };
