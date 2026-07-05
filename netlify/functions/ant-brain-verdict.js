// ant-brain-verdict — Stage 1 of Tech vs Ant 🐜 (Teddy 7/5).
//
// Ant Brain throws a part guess; the tech CONFIRMS it (Ant nailed it) or
// OVERRIDES with the real one (beat the machine). This records the round — the
// training signal that makes the moat smarter AND the raw material the game
// scores — and drops the resolved part number onto the TDR so the tech never
// hunts for it. Reality later grades who was right (ant-brain-grade / Stage 2).
//
//   POST { job_id, tech_id?, tdr_id?, verdict:'confirmed'|'overridden',
//          ant_part, ant_component?, ant_confidence?, tech_part? }
//     -> { ok, part, verdict, beat_ant }
'use strict';

const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const EVENT_LOG = 3, TDR_TABLE = 12;
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return j(200, { ok: true });
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const job_id = parseInt(b.job_id, 10);
  const verdict = String(b.verdict || '') === 'overridden' ? 'overridden' : 'confirmed';
  if (!job_id) return j(400, { ok: false, error: 'job_id required' });

  const ant_part = String(b.ant_part || '').trim();
  const tech_part = String(b.tech_part || '').trim();
  // The part that actually goes on the report: Ant's on confirm, the tech's on override.
  const part = verdict === 'overridden' ? tech_part : ant_part;
  const beat_ant = verdict === 'overridden' && !!tech_part;

  let tok;
  try { tok = authH(); } catch (e) { return j(200, { ok: false, error: String(e.message || e) }); }

  // 1) Record the round — the training + game signal.
  try {
    await fetch(`${META}/table/${EVENT_LOG}/content`, {
      method: 'POST', headers: tok,
      body: JSON.stringify({ action: 'ant_brain_verdict', metadata: {
        job_id, technician_id: Number(b.tech_id || 0) || null, verdict,
        ant_part, ant_component: String(b.ant_component || ''), ant_confidence: Number(b.ant_confidence || 0),
        tech_part, part, beat_ant, at_ms: Date.now(),
      } }),
      signal: AbortSignal.timeout(12000),
    });
  } catch (_) { /* logging best-effort */ }

  // 2) Drop the resolved part number onto the TDR (verified_part_number is a real
  //    text column that persists). Metadata content writes use PUT, not PATCH.
  let wrote = false;
  const tdr_id = parseInt(b.tdr_id, 10) || 0;
  if (tdr_id && part) {
    try {
      const r = await fetch(`${META}/table/${TDR_TABLE}/content/${tdr_id}`, {
        method: 'PUT', headers: tok, body: JSON.stringify({ verified_part_number: part }), signal: AbortSignal.timeout(12000),
      });
      wrote = r.ok;
    } catch (_) {}
  }

  return j(200, { ok: true, part, verdict, beat_ant, wrote });
};
