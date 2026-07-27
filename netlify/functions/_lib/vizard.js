// Vizard connector — the "auto-clip" front of the machine. Feed it a LONG video
// (a full job walkthrough, a ride-along) and it returns the best short moments,
// ranked by a viral score. We take Vizard's RAW clips (its own captions OFF) and
// run each through Submagic for our branded captions/hook — best of both tools.
//
//   createProject({ videoUrl, videoType?, preferLength?, maxClips?, projectName? })
//     -> { ok, projectId }
//   getClips(projectId) -> { ok, ready, clips:[{ videoUrl, title, durationMs, viralScore }] }
//
// Auth header: VIZARDAI_API_KEY  (vault VIZARDAI_API_KEY).
// No per-request webhook — we POLL (vizard-poll cron). code 2000 = ready, 1000 = processing.
'use strict';
const { getSecretPreferVault } = require('./secrets');

const BASE = 'https://elb-api.vizard.ai/hvizard-server-front/open-api/v1';

async function apiKey() { return await getSecretPreferVault('VIZARDAI_API_KEY'); }
async function configured() { return !!(await apiKey()); }

async function req(method, path, body) {
  const key = await apiKey();
  if (!key) return { ok: false, status: 0, error: 'vizard_not_configured' };
  try {
    const r = await fetch(BASE + path, {
      method,
      headers: { 'VIZARDAI_API_KEY': key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    let d = {}; try { d = await r.json(); } catch (_) {}
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) { return { ok: false, status: 0, error: String((e && e.message) || e) }; }
}

// videoType 1 = remote MP4/MOV URL (our signed S3 link).
// preferLength [1,2] = <30s and 30-60s. ratioOfClip 1 = 9:16. removeSilence trims dead air.
// captions=true → Vizard burns its own captions + headline (the FREE volume path, uses
// Creator credits). captions=false → raw clips for Submagic's premium captions.
async function createProject(opts) {
  opts = opts || {};
  const cap = opts.captions ? 1 : 0;
  const vtype = opts.videoType || 1;
  const body = {
    lang: opts.lang || 'en',
    videoUrl: opts.videoUrl,
    videoType: vtype,
    preferLength: Array.isArray(opts.preferLength) ? opts.preferLength : [1, 2],
    ratioOfClip: 1,
    subtitleSwitch: cap,
    headlineSwitch: cap,
    removeSilenceSwitch: 1,
    maxClipNumber: Math.min(Math.max(parseInt(opts.maxClips, 10) || 8, 1), 20),
    projectName: String(opts.projectName || 'TN Appliance').slice(0, 100),
  };
  // videoType 1 = a remote file (our proxy URL): Vizard REQUIRES a non-empty `ext`
  // (the container format) — it errors 4006 without one. Our proxy presents the clip
  // as mp4, so default to 'mp4'.
  if (vtype === 1) body.ext = (opts.ext || 'mp4').replace(/^\./, '').toLowerCase();
  const r = await req('POST', '/project/create', body);
  if (!r.ok || (r.data && r.data.code && r.data.code !== 2000)) return { ok: false, status: r.status, error: (r.data && (r.data.errMsg || r.data.msg)) || r.error || 'create_failed', code: r.data && r.data.code, detail: r.data };
  return { ok: true, projectId: r.data.projectId };
}

async function getClips(projectId) {
  const r = await req('GET', '/project/query/' + encodeURIComponent(projectId));
  if (!r.ok) return { ok: false, status: r.status, error: 'query_failed', detail: r.data };
  const d = r.data || {};
  if (d.code === 1000) return { ok: true, ready: false, clips: [] };       // still processing
  if (d.code !== 2000) return { ok: false, code: d.code, error: (d.errMsg || d.msg) || 'query_error', detail: d };
  const clips = (Array.isArray(d.videos) ? d.videos : []).map((v) => ({
    videoId: v.videoId, videoUrl: v.videoUrl, title: v.title || '',
    durationMs: v.videoMsDuration || 0, viralScore: v.viralScore || '', viralReason: v.viralReason || '',
  }));
  return { ok: true, ready: true, clips, shareLink: d.shareLink };
}

module.exports = { BASE, apiKey, configured, createProject, getClips };
