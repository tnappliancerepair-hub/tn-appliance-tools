// Submagic connector — the "enhance" stage of the video machine. Takes a public
// MP4/MOV URL (a raw tripod clip we host on S3) and returns a finished vertical
// short with burned-in captions, a hook title, auto-zooms, and cleaned audio.
//
//   createProject({ videoUrl, title, hook, template, language, webhookUrl })
//     -> { ok, id, status }              (async; poll getProject or await the webhook)
//   getProject(id) -> { ok, status, downloadUrl }   status: processing|transcribing|exporting|completed|failed
//
// Auth: header  x-api-key: sk-...   (vault SUBMAGIC_API_KEY). Base https://api.submagic.co/v1
'use strict';
const { getSecretPreferVault } = require('./secrets');

const BASE = 'https://api.submagic.co/v1';
// Bold, high-retention caption style suits "fix or not" hero clips. Overridable per job.
const DEFAULT_TEMPLATE = 'Hormozi 2';

async function apiKey() { return await getSecretPreferVault('SUBMAGIC_API_KEY'); }
async function configured() { return !!(await apiKey()); }

async function req(method, path, body) {
  const key = await apiKey();
  if (!key) return { ok: false, status: 0, error: 'submagic_not_configured' };
  try {
    const r = await fetch(BASE + path, {
      method,
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    let d = {}; try { d = await r.json(); } catch (_) {}
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) { return { ok: false, status: 0, error: String((e && e.message) || e) }; }
}

// Kick off a caption/hook/reframe job. Real footage only — magicBrolls is left OFF
// on purpose (stock B-roll reads generic; the moat is the REAL tech on camera).
async function createProject(opts) {
  opts = opts || {};
  const body = {
    title: String(opts.title || 'TN Appliance').slice(0, 100),
    language: opts.language || 'en',
    videoUrl: opts.videoUrl,
    templateName: opts.template || DEFAULT_TEMPLATE,
    magicZooms: opts.magicZooms !== false,       // punchy auto-zooms
    cleanAudio: opts.cleanAudio !== false,       // kill kitchen/shop background noise
    removeSilencePace: opts.pace || 'natural',   // tighten dead air, keep it human
    autoRender: true,                            // render the moment transcription finishes
  };
  if (opts.hook) body.hookTitle = { text: String(opts.hook).slice(0, 90), top: 12, size: 34 };
  if (opts.webhookUrl) body.webhookUrl = opts.webhookUrl;
  if (opts.dictionary && opts.dictionary.length) body.dictionary = opts.dictionary.slice(0, 100);
  const r = await req('POST', '/projects', body);
  if (!r.ok) return { ok: false, status: r.status, error: (r.data && r.data.error) || r.error || 'create_failed', detail: r.data };
  return { ok: true, id: r.data.id, status: r.data.status || 'processing' };
}

async function getProject(id) {
  const r = await req('GET', '/projects/' + encodeURIComponent(id));
  if (!r.ok) return { ok: false, status: r.status, error: 'get_failed', detail: r.data };
  const d = r.data || {};
  return { ok: true, status: d.status, downloadUrl: d.downloadUrl || d.directUrl || null, raw: d };
}

module.exports = { BASE, DEFAULT_TEMPLATE, apiKey, configured, createProject, getProject };
