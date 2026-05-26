#!/usr/bin/env node
// HCP migration import. Paginates HCP /jobs API filtered to open statuses,
// then POSTs each job to /import_hcp_job (idempotent on housecall_pro_job_id).
// Writes a structured log to docs/migration-log.json on completion.
//
// USAGE:
//   node colony-loop/scripts/hcp-migration-import.js           # live import
//   node colony-loop/scripts/hcp-migration-import.js --dry-run # preview only
//   node colony-loop/scripts/hcp-migration-import.js --max=2   # cap page count
//   node colony-loop/scripts/hcp-migration-import.js --statuses=scheduled,in_progress
//
// ENV (from colony-loop/.env or shell):
//   HCP_API_KEY        (required) — same as Xano's HCP_API_KEY env var
//   HCP_BASE_URL       optional, defaults to https://api.housecallpro.com
//   XANO_INTAKE_BASE   (required) — Xano api group URL
//
// Per docs/hcp-migration-plan.md, this runs Saturday morning before HCP is
// retired. Idempotent — safe to re-run.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

// Minimal .env loader so the script works without dotenv installed.
async function loadEnv() {
  try {
    const envPath = path.join(REPO_ROOT, 'colony-loop/.env');
    const raw = await fs.readFile(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env optional
  }
}

function parseArgs() {
  const args = { dryRun: false, maxPages: 100, statuses: 'scheduled,in progress,schedule appointment', perPage: 200 };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--max=')) args.maxPages = parseInt(a.slice(6), 10);
    else if (a.startsWith('--statuses=')) args.statuses = a.slice(11);
    else if (a.startsWith('--per-page=')) args.perPage = parseInt(a.slice(11), 10);
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node hcp-migration-import.js [--dry-run] [--max=N] [--statuses=A,B,C] [--per-page=N]');
      process.exit(0);
    }
  }
  return args;
}

async function hcpFetch(url, apiKey) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Token ${apiKey}`,
      Accept: 'application/json',
    },
  });
  const txt = await res.text();
  let data;
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
  if (!res.ok) {
    throw new Error(`HCP ${res.status}: ${txt.slice(0, 300)}`);
  }
  return data;
}

function isoToMs(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

// Tag-sniffing for warranty company. HCP tags can be free-form; common
// patterns include "AHS", "SquareTrade", "Frontdoor", "Cinch".
const WARRANTY_TAG_RX = /\b(ahs|squaretrade|square trade|frontdoor|front door|cinch|servicepower|service power|2-?10|asurion|ge appliances warranty|whirlpool warranty)\b/i;

function sniffWarrantyCompany(tags) {
  if (!Array.isArray(tags)) return null;
  for (const t of tags) {
    const m = String(t || '').match(WARRANTY_TAG_RX);
    if (m) return m[1].replace(/\s+/g, '').toLowerCase();
  }
  return null;
}

function shapeJobForImport(hcpJob) {
  const cust = hcpJob.customer || {};
  const addr = hcpJob.address || hcpJob.service_address || {};
  const sched = hcpJob.schedule || {};
  const tags = hcpJob.tags || [];
  const warrantyCo = sniffWarrantyCompany(tags);

  return {
    hcp_job_id: String(hcpJob.id || ''),
    hcp_job_number: String(hcpJob.job_number || hcpJob.invoice_number || ''),
    work_status: String(hcpJob.work_status || ''),

    customer_first_name: String(cust.first_name || ''),
    customer_last_name: String(cust.last_name || ''),
    customer_phone: String(cust.mobile_number || cust.home_number || cust.phone || cust.work_number || ''),
    customer_email: String(cust.email || ''),

    service_address: String(addr.street || addr.address || ''),
    service_city: String(addr.city || ''),
    service_state: String(addr.state || ''),
    service_zip: String(addr.zip || addr.postal_code || ''),

    scheduled_start_ms: isoToMs(sched.scheduled_start || sched.start),
    scheduled_end_ms: isoToMs(sched.scheduled_end || sched.end),

    technician_id: null, // intentionally left null; manual mapping post-import
    hcp_assigned_to: Array.isArray(hcpJob.assigned_employee_ids) && hcpJob.assigned_employee_ids[0]
      ? String(hcpJob.assigned_employee_ids[0])
      : '',

    description: String(hcpJob.description || hcpJob.work_status_description || ''),
    notes: String(hcpJob.notes || ''),

    customer_type: warrantyCo ? 'warranty' : 'self_pay',
    warranty_company: warrantyCo ? warrantyCo[0].toUpperCase() + warrantyCo.slice(1) : '',
  };
}

async function importOne(xanoBase, payload) {
  const res = await fetch(`${xanoBase}/import_hcp_job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const txt = await res.text();
  let data;
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
  if (!res.ok || !data.success) {
    const err = new Error(`xano import_hcp_job ${res.status}: ${(data.error || data.message || txt).slice(0, 200)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function main() {
  await loadEnv();

  const args = parseArgs();
  const apiKey = process.env.HCP_API_KEY;
  const baseUrl = process.env.HCP_BASE_URL || 'https://api.housecallpro.com';
  const xanoBase = process.env.XANO_INTAKE_BASE;

  if (!apiKey) {
    console.error('ERR: HCP_API_KEY not set in env or colony-loop/.env');
    process.exit(2);
  }
  if (!xanoBase) {
    console.error('ERR: XANO_INTAKE_BASE not set in env or colony-loop/.env');
    process.exit(2);
  }

  console.log(`HCP migration import — ${args.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  HCP base   : ${baseUrl}`);
  console.log(`  Xano base  : ${xanoBase}`);
  console.log(`  Statuses   : ${args.statuses}`);
  console.log(`  Per page   : ${args.perPage}`);
  console.log(`  Max pages  : ${args.maxPages}`);
  console.log('');

  const startedAt = Date.now();
  const log = {
    started_at_iso: new Date(startedAt).toISOString(),
    started_at_ms: startedAt,
    args,
    base_url: baseUrl,
    xano_base: xanoBase,
    pages_seen: 0,
    total_hcp_jobs: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    failures: [],
    by_action: [],
    finished_at_iso: null,
    elapsed_ms: 0,
  };

  // HCP paginates with ?page=N&per_page=M. The work_status filter must be
  // an array, sent as PHP/Rails-style repeated params: work_status[]=A&work_status[]=B.
  // A single comma-separated string returns HTTP 400 with "work_status filter
  // must be an array of strings".
  const statusesArr = args.statuses
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const workStatusParams = statusesArr
    .map((s) => `work_status[]=${encodeURIComponent(s)}`)
    .join('&');
  let page = 1;

  while (page <= args.maxPages) {
    const url = `${baseUrl}/jobs?${workStatusParams}&page=${page}&per_page=${args.perPage}`;
    process.stdout.write(`page ${page}: fetching…`);
    let resp;
    try {
      resp = await hcpFetch(url, apiKey);
    } catch (err) {
      console.log(` FAIL — ${err.message}`);
      log.failures.push({ phase: 'fetch', page, error: err.message });
      break;
    }

    // HCP returns { jobs: [...], total_pages, page, ... } typically.
    const jobs = Array.isArray(resp.jobs) ? resp.jobs
      : Array.isArray(resp.data) ? resp.data
      : Array.isArray(resp) ? resp
      : [];

    console.log(` ${jobs.length} jobs`);
    log.pages_seen += 1;
    log.total_hcp_jobs += jobs.length;

    if (jobs.length === 0) break;

    for (let i = 0; i < jobs.length; i++) {
      const hcpJob = jobs[i];
      const payload = shapeJobForImport(hcpJob);
      const idx = `[p${page}/${i + 1}]`;

      if (!payload.hcp_job_id) {
        console.log(`  ${idx} SKIP — no hcp_job_id`);
        log.skipped += 1;
        continue;
      }

      if (args.dryRun) {
        console.log(`  ${idx} would-import hcp_id=${payload.hcp_job_id} status=${payload.work_status} phone=${payload.customer_phone.slice(-4) || '----'}`);
        log.skipped += 1;
        log.by_action.push({ hcp_job_id: payload.hcp_job_id, action_taken: 'dry_run', work_status: payload.work_status });
        continue;
      }

      try {
        const result = await importOne(xanoBase, payload);
        const action = result.action_taken || 'unknown';
        if (action === 'created') log.created += 1;
        else if (action === 'updated') log.updated += 1;
        else log.skipped += 1;
        log.by_action.push({
          hcp_job_id: payload.hcp_job_id,
          action_taken: action,
          xano_job_id: result.job_id,
          xano_customer_id: result.customer_id,
        });
        console.log(`  ${idx} ${action} hcp_id=${payload.hcp_job_id} → xano_job=${result.job_id}`);
      } catch (err) {
        log.failed += 1;
        log.failures.push({
          phase: 'import',
          hcp_job_id: payload.hcp_job_id,
          error: err.message,
          status: err.status,
        });
        console.log(`  ${idx} FAIL hcp_id=${payload.hcp_job_id} — ${err.message}`);
      }
    }

    // Stop pagination when we got fewer rows than per_page (last page).
    if (jobs.length < args.perPage) break;
    page += 1;
  }

  const finishedAt = Date.now();
  log.finished_at_iso = new Date(finishedAt).toISOString();
  log.elapsed_ms = finishedAt - startedAt;

  // Write the log.
  const logPath = path.join(REPO_ROOT, 'docs/migration-log.json');
  await fs.writeFile(logPath, JSON.stringify(log, null, 2));

  console.log('');
  console.log(`DONE — ${log.elapsed_ms}ms`);
  console.log(`  Pages seen   : ${log.pages_seen}`);
  console.log(`  HCP jobs seen: ${log.total_hcp_jobs}`);
  console.log(`  Created      : ${log.created}`);
  console.log(`  Updated      : ${log.updated}`);
  console.log(`  Skipped      : ${log.skipped}`);
  console.log(`  Failed       : ${log.failed}`);
  console.log(`  Log written  : ${path.relative(REPO_ROOT, logPath)}`);
}

main().catch((err) => {
  console.error('FATAL', err.stack || err.message || err);
  process.exit(1);
});
