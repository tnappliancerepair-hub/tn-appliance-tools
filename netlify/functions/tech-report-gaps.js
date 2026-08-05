// tech-report-gaps — the completeness watchdog. Surfaces jobs where a tech
// clearly filed a report but a piece the OFFICE needs never landed in the field
// the office reads — so a gap flags itself on Danielle's board instead of turning
// into a "he said / she said" (Jimmy's part numbers, 2026-08-04).
//
// Focus: the recurring, costly gap — the PART NUMBER. A report has real content
// (diagnosis / notes / repair) and the work clearly involved a part, but
// verified_part_number (the column the board, Ann, and the warranty portal read)
// is empty. Two kinds:
//   • recoverable  — a real part-number token IS sitting in the free text
//                    (diagnosis/notes/failed_component) but not in the part field.
//                    ?heal=1 promotes it into verified_part_number automatically.
//   • missing      — the report talks about a part/replacement but there's no
//                    number anywhere → the office must ask the tech before it's lost.
//
// GET                 -> { ok, count, recoverable, missing, gaps:[...] }
// GET ?heal=1&secret= -> also auto-stamp the recoverable ones (owner-gated)
'use strict';

const md = require('./_lib/xano/metadata-crud');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const TDR_TABLE = 12;
const PER = 500, MAX_PAGES = 4;
const ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';

function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }

// A real OEM-part-number token: has a letter AND a digit, 5+ chars (WR02X11479,
// W10876537, DA97-22162A, 3387747). Skips bare small numbers (qty/year/hours).
function partTokens(text) {
  const toks = (String(text || '').match(/[A-Za-z0-9][A-Za-z0-9.\-]{4,}/g) || [])
    .filter((t) => /[A-Za-z]/.test(t) && /\d/.test(t) && !/^\d{1,4}$/.test(t) && !/^(19|20)\d\d$/.test(t));
  const seen = [];
  toks.forEach((t) => { if (seen.indexOf(t) < 0) seen.push(t); });
  return seen.slice(0, 4);
}
// The work involved a part (so an empty part field is a real gap, not a no-parts job).
const PART_WORDS = /\b(part|replace|replaced|gasket|element|valve|pump|motor|board|sensor|kit|belt|seal|igniter|thermostat|compressor|cam|hinge|switch|coil|fan|bearing|control|module|heater|dispenser|actuator|solenoid|wire|harness)\b/i;
function cleanPart(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s || /zz?test|test[\s\-]|\bLOC-\d/i.test(s)) return '';
  if (!/\s/.test(s) && s.length <= 20 && /\d/.test(s)) return s;
  return partTokens(s).join(', ');
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const qp = event.queryStringParameters || {};
  // Scheduled runs (netlify.toml cron) send {next_run} and no query string — they
  // self-authorize and auto-heal so recoverable part #s reach the office with ZERO
  // human taps. Manual heal still needs the owner secret.
  let scheduled = false;
  try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const heal = scheduled || (qp.heal === '1' && qp.secret === ADMIN);
  const gaps = [];
  const seen = {};
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      let rows = [];
      try {
        const r = await fetch(`${META}/table/${TDR_TABLE}/content/search`, {
          method: 'POST', headers: authH(),
          body: JSON.stringify({ sort: { id: 'desc' }, per_page: PER, page }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) break;
        rows = (await r.json()).items || [];
      } catch (_) { break; }
      if (!rows.length) break;
      for (const t of rows) {
        const jid = Number(t.job_id || 0);
        if (!jid || seen[jid]) continue;          // newest TDR per job wins
        seen[jid] = true;
        const diagnosis = String(t.diagnosis || '');
        const notes = String(t.technician_notes || '');
        const failed = String(t.failed_component || '');
        const repair = String(t.repair_completed || '');
        const hasReport = !!(diagnosis.trim() || notes.trim() || repair.trim());
        if (!hasReport) continue;
        const partField = cleanPart(t.verified_part_number);
        if (partField) continue;                   // office can see a part # → fine
        // ALSO recover from the broken parts_needed column — the JSON/array column whose
        // writes the office view never reads (save_part_from_photo + voice landed parts
        // here). It can be a string OR an array Xano renders blank, so normalize both,
        // and treat any content in it as proof this was a parts job. (2026-08-04)
        const partsCol = Array.isArray(t.parts_needed) ? t.parts_needed.filter(Boolean).join(' ') : String(t.parts_needed || '');
        const blob = [partsCol, diagnosis, notes, failed].join('  ');   // parts_needed first → its tokens heal first
        const involvesPart = !!partsCol.trim() || PART_WORDS.test(blob) || partTokens(blob).length > 0;
        if (!involvesPart) continue;               // genuinely a no-parts job → fine
        const tokens = partTokens(blob);
        gaps.push({
          job_id: jid, tdr_id: Number(t.id) || 0,
          kind: tokens.length ? 'recoverable' : 'missing',
          found: tokens, snippet: (diagnosis || notes || failed).slice(0, 140),
          technician_id: Number(t.technician_id) || 0,
        });
      }
      if (rows.length < PER) break;
    }
  } catch (_) {}

  // Optional self-heal: promote a found token into verified_part_number so the
  // office finally sees it (same read-modify-write backfill-part-numbers uses).
  // ?only=<tdr_id> heals just that one row (the "Fix" button); else all recoverable.
  const only = Number(qp.only || 0);
  let healed = 0;
  if (heal) {
    for (const g of gaps.filter((x) => x.kind === 'recoverable' && (!only || x.tdr_id === only))) {
      try {
        const rows = await md.search(TDR_TABLE, { id: g.tdr_id });
        const row = Array.isArray(rows) ? (rows.find((r) => Number(r.id) === g.tdr_id) || rows[0]) : null;
        if (!row) continue;
        const merged = Object.assign({}, row, { verified_part_number: g.found.join(', ') });
        delete merged.id; delete merged.created_at;
        await md.update(TDR_TABLE, g.tdr_id, merged);
        g.healed = true; healed++;
      } catch (_) {}
    }
  }

  const recoverable = gaps.filter((g) => g.kind === 'recoverable').length;
  const missing = gaps.filter((g) => g.kind === 'missing').length;
  return j(200, { ok: true, count: gaps.length, recoverable, missing, healed, gaps });
};
