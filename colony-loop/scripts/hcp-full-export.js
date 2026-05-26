#!/usr/bin/env node
// HCP full export — pulls every open HCP job + completed jobs from the last
// 30 days, writes the raw HCP payloads to docs/hcp-full-export.json. Used
// once on migration-day Saturday as a safety snapshot before HCP retires.
//
// Differs from hcp-migration-import.js:
//   - export-only: no Xano writes (read-only against HCP)
//   - covers ALL non-canceled statuses, not just the open set
//   - includes 30-day completed window for history
//   - writes the raw HCP job objects (no shape transformation)
//
// USAGE:
//   node colony-loop/scripts/hcp-full-export.js
//   node colony-loop/scripts/hcp-full-export.js --completed-days=30 --max=200
//   node colony-loop/scripts/hcp-full-export.js --out=docs/hcp-2026-05-30.json
//
// ENV: HCP_API_KEY (required), HCP_BASE_URL (default api.housecallpro.com)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

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
  } catch { /* optional */ }
}

function parseArgs() {
  const args = {
    completedDays: 30,
    maxPages: 200,
    perPage: 200,
    out: 'docs/hcp-full-export.json',
  };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--completed-days=')) args.completedDays = parseInt(a.slice(17), 10);
    else if (a.startsWith('--max=')) args.maxPages = parseInt(a.slice(6), 10);
    else if (a.startsWith('--per-page=')) args.perPage = parseInt(a.slice(11), 10);
    else if (a.startsWith('--out=')) args.out = a.slice(6);
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node hcp-full-export.js [--completed-days=30] [--max=200] [--per-page=200] [--out=path.json]');
      process.exit(0);
    }
  }
  return args;
}

async function hcpFetch(url, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Token ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    const txt = await res.text();
    let data;
    try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
    if (!res.ok) throw new Error(`HCP ${res.status}: ${txt.slice(0, 300)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Pull every page for a given set of work_status filter values.
async function pullStatuses(baseUrl, apiKey, statuses, maxPages, perPage, sinceMs = null) {
  const collected = [];
  let page = 1;
  while (page <= maxPages) {
    const url = new URL(`${baseUrl}/jobs`);
    for (const s of statuses) url.searchParams.append('work_status[]', s);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(perPage));
    process.stdout.write(`  page ${page} statuses=[${statuses.join(',')}]…`);
    let resp;
    try {
      resp = await hcpFetch(url, apiKey);
    } catch (err) {
      console.log(` FAIL — ${err.message}`);
      throw err;
    }
    const jobs = Array.isArray(resp.jobs) ? resp.jobs
      : Array.isArray(resp.data) ? resp.data
      : Array.isArray(resp) ? resp : [];
    console.log(` ${jobs.length} jobs`);
    if (jobs.length === 0) break;

    // For the completed-window pull, filter client-side by completion date.
    let kept = jobs;
    if (sinceMs) {
      kept = jobs.filter((j) => {
        const t = Date.parse(j.work_timestamps?.completed_at || j.completed_at || j.work_status_completed_at || j.updated_at || '');
        return Number.isFinite(t) && t >= sinceMs;
      });
      console.log(`    kept ${kept.length} after completion-window filter`);
    }

    collected.push(...kept);

    // If client-side filter dropped everything AND we got a full page of older
    // completions, stop (sorted by recency on HCP side).
    if (sinceMs && kept.length === 0 && jobs.length === perPage) {
      console.log('    completion-window passed end — stopping');
      break;
    }
    if (jobs.length < perPage) break;
    page += 1;
  }
  return collected;
}

async function main() {
  await loadEnv();
  const args = parseArgs();
  const apiKey = process.env.HCP_API_KEY;
  const baseUrl = process.env.HCP_BASE_URL || 'https://api.housecallpro.com';

  if (!apiKey) {
    console.error('ERR: HCP_API_KEY not set');
    process.exit(2);
  }

  console.log(`HCP full export — ${args.completedDays}d completed window`);
  console.log(`  base    : ${baseUrl}`);
  console.log(`  out     : ${args.out}`);
  console.log(`  max pages: ${args.maxPages}`);
  console.log('');

  const sinceMs = Date.now() - args.completedDays * 24 * 60 * 60 * 1000;

  const summary = {
    started_at_iso: new Date().toISOString(),
    completed_window_days: args.completedDays,
    completed_since_iso: new Date(sinceMs).toISOString(),
    open_jobs: 0,
    completed_jobs: 0,
    open_statuses_pulled: ['scheduled', 'in progress', 'schedule appointment', 'pending', 'needs scheduling'],
    completed_statuses_pulled: ['complete', 'completed', 'complete unrated', 'complete rated'],
    failed_window_pulls: [],
  };

  console.log('Pulling OPEN jobs…');
  let openJobs = [];
  try {
    openJobs = await pullStatuses(baseUrl, apiKey, summary.open_statuses_pulled, args.maxPages, args.perPage, null);
  } catch (err) {
    summary.failed_window_pulls.push({ window: 'open', error: err.message });
  }
  summary.open_jobs = openJobs.length;
  console.log(`  total open jobs: ${openJobs.length}`);
  console.log('');

  console.log(`Pulling COMPLETED jobs (last ${args.completedDays} days)…`);
  let completedJobs = [];
  try {
    completedJobs = await pullStatuses(baseUrl, apiKey, summary.completed_statuses_pulled, args.maxPages, args.perPage, sinceMs);
  } catch (err) {
    summary.failed_window_pulls.push({ window: 'completed', error: err.message });
  }
  summary.completed_jobs = completedJobs.length;
  console.log(`  total completed jobs in window: ${completedJobs.length}`);
  console.log('');

  // Dedup by HCP job id (some jobs flip status mid-export).
  const byId = new Map();
  for (const j of [...openJobs, ...completedJobs]) {
    const id = j.id || j.uuid || j.hcp_id || JSON.stringify(j).slice(0, 60);
    if (!byId.has(id)) byId.set(id, j);
  }
  const allJobs = Array.from(byId.values());
  summary.unique_jobs_total = allJobs.length;
  summary.finished_at_iso = new Date().toISOString();

  const outPath = path.resolve(REPO_ROOT, args.out);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({ summary, jobs: allJobs }, null, 2));

  console.log(`Wrote ${allJobs.length} unique jobs to ${outPath}`);
  console.log(`Summary: open=${summary.open_jobs} completed=${summary.completed_jobs} unique=${summary.unique_jobs_total}`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
