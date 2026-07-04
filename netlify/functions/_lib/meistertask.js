// meistertask.js — thin MeisterTask REST client. Pulls the 7-year history
// (projects -> sections -> tasks -> comments) so we can archive it into Supabase
// without the manual export/download/upload dance.
//
// Auth: a personal access token (or OAuth access token) in the vault as
// MEISTERTASK_TOKEN (vault-first via getSecret). API is standard REST + Bearer.
//   API docs: https://developers.meister.co / https://www.meistertask.com/api
'use strict';

const { getSecretPreferVault } = require('./secrets');

const BASE = (process.env.MEISTERTASK_API_BASE || 'https://www.meistertask.com/api').replace(/\/+$/, '');
let _token = null;

// Vault-FIRST + cache-only-when-found: getSecretPreferVault never caches the
// empty case, so a token added to the vault after a cold probe is picked up on
// the next warm call (a plain getSecret would cache '' and stay "not configured").
async function token() {
  if (_token) return _token;
  const t = String((await getSecretPreferVault('MEISTERTASK_TOKEN')) || '');
  if (t) _token = t;
  return t;
}

async function isConfigured() { return !!(await token()); }

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Global min-interval throttle so we never burst into MeisterTask's rate limit.
// ~1.1s between calls (≈55/min) — tune via MEISTERTASK_PACE_MS.
const PACE_MS = Number(process.env.MEISTERTASK_PACE_MS || 1100);
let _lastCallAt = 0;
async function pace() {
  const wait = _lastCallAt + PACE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  _lastCallAt = Date.now();
}

// GET with bearer auth + a timeout, with 429 backoff. MeisterTask rate-limits
// the API aggressively ("429 Retry later"), so on a 429 we honor Retry-After
// (or exp-backoff) and retry a handful of times before giving up.
async function mtGet(path, params, { retries = 5 } = {}) {
  const tok = await token();
  if (!tok) throw new Error('meistertask_not_configured (set MEISTERTASK_TOKEN)');
  const qs = params ? ('?' + new URLSearchParams(params).toString()) : '';
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await pace();
    let r;
    try {
      r = await fetch(`${BASE}${path}${qs}`, {
        headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' },
        signal: AbortSignal.timeout(25000),
      });
    } catch (e) { lastErr = e; await sleep(1500 * (attempt + 1)); continue; }
    if (r.status === 429) {
      const ra = Number(r.headers.get('retry-after'));
      const waitMs = ra > 0 ? (ra * 1000 + 500) : Math.min(30000, 2000 * Math.pow(2, attempt));
      lastErr = new Error(`meistertask ${path} -> 429 (waited ${waitMs}ms)`);
      lastErr.status = 429;
      if (attempt < retries) { await sleep(waitMs); continue; }
      throw lastErr;
    }
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      const e = new Error(`meistertask ${path} -> ${r.status}: ${body.slice(0, 180)}`);
      e.status = r.status;
      throw e;
    }
    return r.json();
  }
  throw lastErr || new Error('meistertask ' + path + ' failed');
}

// Page through a list endpoint (MeisterTask supports ?page & ?per_page; a short
// page signals the end). Caps pages as a runaway backstop.
async function mtList(path, { perPage = 50, maxPages = 2000, params = {} } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    let chunk;
    try { chunk = await mtGet(path, { ...params, page, per_page: perPage }); }
    catch (e) { if (page === 1) throw e; break; }
    if (!Array.isArray(chunk)) { if (chunk) out.push(chunk); break; }
    out.push(...chunk);
    if (chunk.length < perPage) break;
  }
  return out;
}

// POST with bearer auth (+ 429 backoff), for creating tasks/cards.
async function mtPost(path, body, { retries = 3 } = {}) {
  const tok = await token();
  if (!tok) throw new Error('meistertask_not_configured (set MEISTERTASK_TOKEN)');
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await pace();
    let r;
    try {
      r = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: AbortSignal.timeout(25000),
      });
    } catch (e) { lastErr = e; await sleep(1500 * (attempt + 1)); continue; }
    if (r.status === 429) {
      const ra = Number(r.headers.get('retry-after'));
      const waitMs = ra > 0 ? (ra * 1000 + 500) : Math.min(30000, 2000 * Math.pow(2, attempt));
      lastErr = new Error(`meistertask POST ${path} -> 429`); lastErr.status = 429;
      if (attempt < retries) { await sleep(waitMs); continue; }
      throw lastErr;
    }
    if (!r.ok) { const b = await r.text().catch(() => ''); const e = new Error(`meistertask POST ${path} -> ${r.status}: ${b.slice(0, 180)}`); e.status = r.status; throw e; }
    return r.json().catch(() => ({}));
  }
  throw lastErr || new Error('meistertask POST ' + path + ' failed');
}

// Create a task (card) in a section. name = title, notes = markdown body.
const createTask = (sectionId, { name, notes }) => mtPost(`/sections/${sectionId}/tasks`, { name, notes });

// Delete (trash) a task by id.
async function deleteTask(taskId) {
  const tok = await token();
  if (!tok) throw new Error('meistertask_not_configured');
  await pace();
  const r = await fetch(`${BASE}/tasks/${taskId}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' },
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok && r.status !== 404) { const b = await r.text().catch(() => ''); throw new Error(`meistertask DELETE /tasks/${taskId} -> ${r.status}: ${b.slice(0, 120)}`); }
  return { ok: true, status: r.status };
}

// ---- domain helpers -------------------------------------------------------
// NOTE: do NOT pass status=all — MeisterTask 400s on it ("Invalid value for
// status parameter"). The default (no status) already returns EVERY task,
// including archived/completed (status 8) and open (status 1) — verified live.
const listProjects = () => mtList('/projects', { params: { status: 'all' } });
const listSections = (projectId) => mtList(`/projects/${projectId}/sections`);
const listSectionTasks = (sectionId, opts = {}) => mtList(`/sections/${sectionId}/tasks`, opts);
const listProjectTasks = (projectId, opts = {}) => mtList(`/projects/${projectId}/tasks`, opts);
const listTaskComments = (taskId) => mtList(`/tasks/${taskId}/comments`);
const listLabels = (projectId) => mtList(`/projects/${projectId}/labels`);

module.exports = {
  isConfigured, token, mtGet, mtList, mtPost, createTask, deleteTask,
  listProjects, listSections, listSectionTasks, listProjectTasks, listTaskComments, listLabels,
};
