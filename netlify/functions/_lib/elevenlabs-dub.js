// ElevenLabs Dubbing connector — translate a clip's spoken audio into another
// language (Spanish first) with natural voice. Doubles the reach of every hit with
// zero new filming. Async: create -> poll -> download.
//   createDub({ source_url, target_lang, source_lang?, name? }) -> { ok, dubbing_id }
//   getStatus(id) -> { ok, status }   status: 'dubbing' | 'dubbed' | 'failed'
//   download(id, lang) -> { ok, buffer }   the dubbed mp4
'use strict';
const { getSecretPreferVault } = require('./secrets');
const API = 'https://api.elevenlabs.io/v1';

async function key() { return getSecretPreferVault('ELEVENLABS_API_KEY'); }
async function configured() { return !!(await key()); }

async function createDub(opts) {
  const k = await key();
  if (!k) return { ok: false, error: 'not_configured' };
  const fd = new FormData();
  fd.append('source_url', opts.source_url);
  fd.append('target_lang', opts.target_lang || 'es');
  if (opts.source_lang) fd.append('source_lang', opts.source_lang);
  fd.append('num_speakers', '0');       // auto-detect
  // NB: do NOT send watermark:false — it's a Starter+ feature and rejects the whole
  // create on the base plan ("Dubbing without a watermark is only available for
  // Starter+ users"). Dub WITH the watermark (works on every plan). Re-add the opt-out
  // only when the plan supports it.
  if (opts.name) fd.append('name', String(opts.name).slice(0, 80));
  try {
    const r = await fetch(`${API}/dubbing`, { method: 'POST', headers: { 'xi-api-key': k }, body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.dubbing_id) return { ok: false, status: r.status, error: (d.detail && (d.detail.message || d.detail)) || d.error || 'create_failed', detail: d };
    return { ok: true, dubbing_id: d.dubbing_id, expected: d.expected_duration_sec };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

async function getStatus(id) {
  const k = await key();
  try {
    const r = await fetch(`${API}/dubbing/${encodeURIComponent(id)}`, { headers: { 'xi-api-key': k } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: 'status_failed', detail: d };
    return { ok: true, status: d.status, target_languages: d.target_languages, error_detail: d.error };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

async function download(id, lang) {
  const k = await key();
  try {
    const r = await fetch(`${API}/dubbing/${encodeURIComponent(id)}/audio/${encodeURIComponent(lang)}`, { headers: { 'xi-api-key': k } });
    if (!r.ok) { const t = await r.text().catch(() => ''); return { ok: false, status: r.status, error: 'download_failed', detail: t.slice(0, 200) }; }
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: !!buf.length, buffer: buf, size: buf.length };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

module.exports = { API, key, configured, createDub, getStatus, download };
