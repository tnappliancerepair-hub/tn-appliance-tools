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

// GET with bearer auth + a timeout. Returns parsed JSON (array or object).
async function mtGet(path, params) {
  const tok = await token();
  if (!tok) throw new Error('meistertask_not_configured (set MEISTERTASK_TOKEN)');
  const qs = params ? ('?' + new URLSearchParams(params).toString()) : '';
  const r = await fetch(`${BASE}${path}${qs}`, {
    headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' },
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    const e = new Error(`meistertask ${path} -> ${r.status}: ${body.slice(0, 180)}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
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

// ---- domain helpers -------------------------------------------------------
const listProjects = () => mtList('/projects', { params: { status: 'all' } });
const listSections = (projectId) => mtList(`/projects/${projectId}/sections`);
// tasks: try section-scoped first (most reliable); status=all to include done/archived.
const listSectionTasks = (sectionId) => mtList(`/sections/${sectionId}/tasks`, { params: { status: 'all' } });
const listProjectTasks = (projectId) => mtList(`/projects/${projectId}/tasks`, { params: { status: 'all' } });
const listTaskComments = (taskId) => mtList(`/tasks/${taskId}/comments`);

module.exports = {
  isConfigured, token, mtGet, mtList,
  listProjects, listSections, listSectionTasks, listProjectTasks, listTaskComments,
};
