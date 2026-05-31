// Tech-requested reassignment.
// Called from tech-ant.html's "Reassignment Needed" completion button after
// create_tdr has already written the TDR row. This function:
//   1. Clears jobs.technician_id (back to 0/null)
//   2. Clears jobs.scheduled_start + jobs.scheduled_end
//   3. Sets jobs.scheduling_status = "needs_scheduled"
//   4. Writes an event_log row recording who requested reassignment + why
//
// Result: the job pops back into the office's "Needs Scheduled" bucket for
// manual re-routing. The TDR explains the situation.
//
// Why this isn't just an extra branch in tech_job_complete: that endpoint's
// completion_type enum is (repair_complete, parts_needed, warranty_auth_needed,
// no_repair). Adding a 5th value requires an XS edit + paste. This Netlify
// function side-steps that for the test cycle.

const XANO_META_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const TABLES = {
  jobs: 7,
  event_log: 3,
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'method not allowed' });
  }
  if (!process.env.XANO_METADATA_TOKEN) {
    return json(500, { ok: false, error: 'XANO_METADATA_TOKEN missing' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_e) {
    return json(400, { ok: false, error: 'invalid json body' });
  }

  const jobId = parseInt(body.job_id, 10);
  const techId = parseInt(body.technician_id, 10);
  const tdrId = body.tdr_id ? parseInt(body.tdr_id, 10) : null;
  const reason = (body.reason || '').toString().slice(0, 500);

  if (!Number.isFinite(jobId) || jobId <= 0) {
    return json(400, { ok: false, error: 'job_id required (positive int)' });
  }

  try {
    // 1. PATCH the job: clear assignment, reset scheduling_status
    const patchRes = await fetch(
      `${XANO_META_BASE}/table/${TABLES.jobs}/content/${jobId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${process.env.XANO_METADATA_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          technician_id: 0,
          scheduled_start: null,
          scheduled_end: null,
          scheduling_status: 'needs_scheduled',
          current_status: 'needs_scheduled',
        }),
      },
    );
    if (!patchRes.ok) {
      const t = await patchRes.text();
      return json(500, {
        ok: false,
        error: `job PATCH failed: HTTP ${patchRes.status}: ${t.slice(0, 200)}`,
      });
    }

    // 2. event_log row for audit
    const auditPayload = {
      action: 'tech_requested_reassignment',
      metadata: JSON.stringify({
        job_id: jobId,
        previous_technician_id: techId || null,
        tdr_id: tdrId,
        reason,
      }),
    };
    try {
      await fetch(`${XANO_META_BASE}/table/${TABLES.event_log}/content`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.XANO_METADATA_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(auditPayload),
      });
    } catch (_e) {
      // audit failure non-fatal — the routing change already succeeded
    }

    return json(200, {
      ok: true,
      success: true, // mirrors tech_job_complete response shape so caller checks identically
      job_id: jobId,
      action: 'reassignment_requested',
      message: 'Job returned to Needs Scheduled for re-routing',
    });
  } catch (e) {
    return json(500, { ok: false, error: String(e.message || e) });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}
