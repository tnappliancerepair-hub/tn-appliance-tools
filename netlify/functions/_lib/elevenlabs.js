// ElevenLabs connector — AI voiceover for faceless marketing videos (tip clips,
// review readouts, etc.). The 11labs key on Vapi lives inside Vapi's dashboard and
// is NOT reachable by us, so this uses a SEPARATE key from the owner's ElevenLabs
// account, dropped in the vault as ELEVENLABS_API_KEY. Vault-first, activates the
// moment the key lands (same staging pattern as the other connectors).
'use strict';
const { getSecretPreferVault } = require('./secrets');

const API = 'https://api.elevenlabs.io/v1';
// A warm, natural default voice ("Rachel"); override per call or via ELEVENLABS_VOICE_ID.
const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM';

async function key() { return getSecretPreferVault('ELEVENLABS_API_KEY'); }

// Verify the key + read the account (quota). Returns {ok, configured, subscription}.
async function check() {
  const k = await key();
  if (!k) return { ok: false, configured: false, missing: ['ELEVENLABS_API_KEY'] };
  try {
    const r = await fetch(`${API}/user`, { headers: { 'xi-api-key': k } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, configured: true, error: (d && d.detail && d.detail.message) || ('http ' + r.status) };
    const s = d.subscription || {};
    return { ok: true, configured: true, tier: s.tier, chars_used: s.character_count, chars_limit: s.character_limit, chars_left: (s.character_limit || 0) - (s.character_count || 0) };
  } catch (e) { return { ok: false, configured: true, error: String((e && e.message) || e) }; }
}

async function listVoices() {
  const k = await key();
  if (!k) return { ok: false, configured: false };
  try {
    const r = await fetch(`${API}/voices`, { headers: { 'xi-api-key': k } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: 'http ' + r.status };
    return { ok: true, voices: (d.voices || []).map((v) => ({ id: v.voice_id, name: v.name })) };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// Text -> mp3 bytes. opts: { voiceId?, modelId? }. Returns { ok, buffer, mime }.
async function tts(text, opts) {
  opts = opts || {};
  const k = await key();
  if (!k) return { ok: false, configured: false };
  const voiceId = opts.voiceId || (await getSecretPreferVault('ELEVENLABS_VOICE_ID')) || DEFAULT_VOICE;
  const body = { text: String(text || '').slice(0, 5000), model_id: opts.modelId || 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } };
  try {
    const r = await fetch(`${API}/text-to-speech/${voiceId}`, { method: 'POST', headers: { 'xi-api-key': k, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(body) });
    if (!r.ok) { const t = await r.text().catch(() => ''); return { ok: false, error: 'http ' + r.status, detail: t.slice(0, 200) }; }
    const ab = await r.arrayBuffer();
    return { ok: true, buffer: Buffer.from(ab), mime: 'audio/mpeg', size: ab.byteLength };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

module.exports = { API, DEFAULT_VOICE, key, check, listVoices, tts };
