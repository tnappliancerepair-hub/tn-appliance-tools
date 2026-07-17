// address-flags — feeds the office board's address-confirmation flags (Teddy
// 2026-07-17). A customer with two addresses on file is texted to confirm which
// house; this returns each job's live state so the tile can show:
//   • pending  — asked, no reply yet (amber "confirming address…")
//   • confirmed — customer said YES (green ✓, transient)
//   • correction — customer sent a DIFFERENT address (red, needs Danielle) with
//       the address WE asked about + the customer's proposed correction, so she
//       can apply it in one tap.
// Resolution wins over pending (a later confirmed/correction/applied supersedes).
'use strict';
const crud = require('./_lib/xano/metadata-crud');

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

async function rowsFor(action, n) { try { return (await crud.searchPage(crud.TABLES.event_log, { action }, { id: 'desc' }, n || 800)) || []; } catch (_) { return []; } }

exports.handler = async function () {
  try {
    const [sent, confirmed, corrected, applied] = await Promise.all([
      rowsFor('address_confirm_sent'), rowsFor('address_confirmed'),
      rowsFor('address_correction_reported'), rowsFor('address_correction_applied'),
    ]);
    // newest event per job per action
    const firstByJob = (rows) => { const seen = {}; for (const r of rows) { const m = metaOf(r); const jid = Number(m.job_id || 0); if (jid && !seen[jid]) seen[jid] = { m, at: Number(r.created_at) || Number(m.at_ms) || 0 }; } return seen; };
    const S = firstByJob(sent), C = firstByJob(confirmed), R = firstByJob(corrected), A = firstByJob(applied);

    const out = [];
    for (const jid of Object.keys(S)) {
      const id = Number(jid);
      const appliedAt = A[id] ? A[id].at : 0;
      const correctedAt = R[id] ? R[id].at : 0;
      const confirmedAt = C[id] ? C[id].at : 0;
      let state, proposed = '';
      if (correctedAt && correctedAt > appliedAt) { state = 'correction'; proposed = String((R[id].m && R[id].m.proposed) || ''); }
      else if (appliedAt) { continue; }                      // Danielle fixed it — drop the flag
      else if (confirmedAt) { state = 'confirmed'; }
      else { state = 'pending'; }
      const m = S[id].m || {};
      out.push({
        job_id: id, state, proposed,
        asked_address: [m.service_address, m.service_city, m.service_zip].filter(Boolean).join(', '),
        at: state === 'correction' ? correctedAt : (state === 'confirmed' ? confirmedAt : S[id].at),
      });
    }
    return j(200, { ok: true, address_flags: out });
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e), address_flags: [] });
  }
};
