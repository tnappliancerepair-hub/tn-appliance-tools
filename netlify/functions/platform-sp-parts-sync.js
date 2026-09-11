// platform-sp-parts-sync — put the VENDOR'S OWN parts list on the job, with what shipped and
// when it lands, so a tech knows before he drives whether the parts are actually there.
//
// Teddy 2026-09-11: "Even parts eta and what has been sent would be helpful on the job so the
// tech knows if parts are there or not and what was sent so they can manage the parts
// efficiently."
//
// WHY THIS EXISTS: until now a part only appeared on a job if its EMAIL arrived and parsed.
// Measured 2026-09-11 on claim 070570184134 the email list and the API list DISAGREE -- the
// email had missed a MAIN BOARD and a USER INTERFACE BOARD that SquareTrade had shipped.
// Unreturned parts are exactly what they charge back for. So the API becomes the spine and
// the email keeps supplying what only it has (the prepaid return label + RMA number).
//
// SAFETY -- this is additive by construction:
//   * never deletes a row
//   * never touches what a human/tech owns: disposition, photo_ref, cost_cents, sell_cents,
//     returned_at/returned_by, rma_number, return_tracking, return_carrier
//   * only fills BLANK fields, plus the ship_* columns it owns outright
//   * an empty value from the API can never erase a known one
//
//   GET/POST ?secret=<admin>        run (writes) -- add &dry=1 to shadow
//   &company=<uuid>                 one shop (default: TN)
//   &job=<uuid>                     one job (testing)
//   &limit=N                        max jobs per run (default 12; SOAP is ~1-2s each)
//   scheduled (Netlify cron)        self-authorizes via {next_run}
'use strict';
const sp = require('./_lib/servicepower');
const spTenant = require('./_lib/servicepower-tenant');
const fedex = require('./_lib/fedex');
const { getSecret } = require('./_lib/secrets');

const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
exports.config = { timeout: 26 };

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

async function ctx() {
  const base = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { base, H: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } };
}
async function sget(base, H, path) {
  try { const r = await fetch(base + '/rest/v1/' + path, { headers: H, signal: AbortSignal.timeout(9000) }); return r.ok ? (await r.json().catch(() => [])) : []; } catch (_) { return []; }
}
async function spatch(base, H, path, row) {
  try { const r = await fetch(base + '/rest/v1/' + path, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(9000) }); return r.ok; } catch (_) { return false; }
}
async function sins(base, H, table, row) {
  try { const r = await fetch(base + '/rest/v1/' + table, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(9000) }); return r.ok; } catch (_) { return false; }
}

// ── part-number matching ──────────────────────────────────────────────────
// The email parser has been writing descriptive junk into `number`:
//   "THERMOSTAT HI LIMIT WE04X30381\nPart #WE04X30381"   (name NULL)
// so matching has to EXTRACT a part number rather than compare the field.
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// A part number is a 5+ char token that is either alphanumeric (WE04X30381, DC97-16350U) or
// purely numeric but long enough not to be a quantity/year/price (8583165300010, 316530001).
function looksLikePartNo(t) {
  if (t.length < 5) return false;
  if (!/\d/.test(t)) return false;                 // must contain a digit
  if (/^\d+$/.test(t)) return t.length >= 6;       // pure numbers: Whirlpool/Frigidaire style
  return true;
}
// When a row says "Part #X", X is the authoritative part for that row -- and anything after
// "Replaces #" is a SUPERSEDED number, not this row's identity. Honoring that keeps ship info
// from being attached to the wrong row.
function extractPartNos(text) {
  const raw = String(text || '');
  const explicit = [];
  const re = /part\s*#\s*([A-Za-z0-9-]{5,})/gi;
  let m; while ((m = re.exec(raw))) explicit.push(m[1].replace(/-+$/, ''));
  if (explicit.length) return explicit.filter(looksLikePartNo);
  const out = [];
  for (const tok of raw.split(/[^A-Za-z0-9-]+/)) {
    const t = tok.replace(/-+$/, '');
    if (looksLikePartNo(t)) out.push(t);
  }
  return out;
}
// Does this existing row refer to the API's part?
function rowMatches(row, apiPart) {
  const target = norm(apiPart);
  if (!target) return false;
  if (norm(row.number) === target) return true;
  for (const cand of extractPartNos(row.number)) if (norm(cand) === target) return true;
  for (const cand of extractPartNos(row.name)) if (norm(cand) === target) return true;
  return false;
}

// "09/04/2026 15:48:06" -> ISO. ServicePower speaks US dates.
function noteToIso(s) {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], +(m[4] || 12), +(m[5] || 0), +(m[6] || 0))).toISOString();
}

async function runSync(q) {
  q = q || {};
  const dry = q.dry === '1' || q.dry === 'true' || q.dry === true;
  const companyId = q.company || TN_COMPANY;
  const limit = Math.min(40, Math.max(1, parseInt(q.limit || '12', 10) || 12));

  const { base, H } = await ctx();
  if (!base || !H.apikey) return json(200, { ok: false, error: 'platform_not_configured' });

  // Run as the shop when it has its own ServicePower credentials; otherwise fall through to
  // the vault (TN today). Structuring it this way now is what lets a second shop -- or the
  // AHS/Frontdoor equivalent -- reuse this without a rewrite.
  const bound = await spTenant.forCompany(companyId).catch(() => null);
  const getNotes = bound ? ((a) => bound.getCallNotes(a)) : ((a) => sp.getCallNotes(a));

  // Candidate jobs: a ServicePower/SquareTrade dispatch that is still live, plus recently
  // completed ones (returns stay relevant for days after the visit).
  const cutoff = encodeURIComponent(new Date(Date.now() - 14 * 86400000).toISOString());
  // The vendor filter has to live in the QUERY, not in JS after the limit -- otherwise a batch
  // of N is mostly non-ServicePower jobs that get thrown away, and the sweep crawls. Nested
  // and=(or(...),or(...)) is how PostgREST expresses "still live AND a ServicePower vendor".
  const liveOr = `or(status.neq.completed,completed_at.gte.${cutoff})`;
  const vendorOr = 'or(warranty_company.ilike.*square*,warranty_company.ilike.*allstate*,warranty_company.ilike.*servicepower*,warranty_company.ilike.*service power*)';
  let jf = `job?company_id=eq.${companyId}&claim_number=not.is.null&claim_number=neq.&status=neq.canceled`
    + `&and=(${liveOr},${vendorOr})`
    // Oldest-synced first (never-synced first). Without this cursor the sweep would re-process
    // the same newest N jobs forever and the other ~300 would never be looked at.
    + `&select=id,claim_number,warranty_company,status,scheduled_day,sp_parts_synced_at`
    + `&order=sp_parts_synced_at.asc.nullsfirst&limit=${limit}`;
  if (q.job) jf = `job?id=eq.${q.job}&select=id,claim_number,warranty_company,status,scheduled_day,sp_parts_synced_at&limit=1`;
  const jobs = await sget(base, H, jf);

  const DAY = 86400000, nowMs = Date.now();
  const fdt = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  const out = {
    ok: true, dry, company: companyId, tenant_creds: !!bound,
    jobs_considered: jobs.length, jobs_with_api_parts: 0,
    inserted: 0, updated: 0, repaired: 0, unchanged: 0, api_parts_seen: 0, must_return_flagged: 0, errors: [],
    tracking_numbers: [], results: [],
  };

  const trackingSeen = new Set();
  const touchedByTracking = [];   // [{rowId, tracking}] to enrich after FedEx

  for (const j of jobs) {
    // claim_number can be '' (empty string) -- that passes a not-null filter and, sent as Callno,
    // makes ServicePower return every note in the window across every dispatch. Skip and stamp so
    // it leaves the queue instead of blocking the head of it.
    const claim = String(j.claim_number || '').trim();
    if (!claim) {
      out.skipped_no_claim = (out.skipped_no_claim || 0) + 1;
      if (!dry) await spatch(base, H, `job?id=eq.${j.id}`, { sp_parts_synced_at: new Date().toISOString() });
      continue;
    }
    let apiParts = [];
    try {
      const r = await getNotes({ callNumber: claim, fromDateTime: fdt(nowMs - 180 * DAY), toDateTime: fdt(nowMs + DAY) });
      apiParts = sp.partsFromNotes((r && r.raw) || '');
    } catch (e) { out.errors.push({ job: j.id, claim: claim, error: String((e && e.message) || e).slice(0, 120) }); continue; }
    // Stamp the cursor even when there is nothing to sync -- otherwise a job with no parts is
    // retried every run and permanently blocks the head of the queue.
    if (!dry) await spatch(base, H, `job?id=eq.${j.id}`, { sp_parts_synced_at: new Date().toISOString() });
    if (!apiParts.length) continue;
    // Sanity ceiling. A real dispatch carries a handful of parts; anything wild means the call
    // was not scoped and we are looking at somebody else's work. Refuse rather than write it.
    if (apiParts.length > 25) {
      out.errors.push({ job: j.id, claim: claim, error: 'refused_' + apiParts.length + '_parts_unscoped' });
      continue;
    }
    out.jobs_with_api_parts++;
    out.api_parts_seen += apiParts.length;

    const existing = await sget(base, H, `job_part?job_id=eq.${j.id}&select=id,name,number,disposition,ship_tracking,ship_carrier,source,must_return&limit=200`);
    const jobRes = { job: j.id, claim: claim, api_parts: apiParts.length, actions: [] };

    for (const p of apiParts) {
      if (p.tracking) trackingSeen.add(p.tracking);
      const row = existing.find((e) => rowMatches(e, p.part));

      if (!row) {
        const ins = {
          company_id: companyId, job_id: j.id,
          number: p.part, name: p.description || null,
          source: 'servicepower_api',
          ship_tracking: p.tracking || null,
          ship_carrier: p.carrier || null,
          // The vendor's own rule, known at order time: owed back even if used (a core).
          // Kept separate from `disposition`, which is what the tech actually did with it.
          must_return: (p.requires_return === true) ? true : (p.requires_return === false ? false : null),
          order_status: 'ordered',
        };
        if (p.requires_return === true) out.must_return_flagged++;
        jobRes.actions.push({ part: p.part, action: 'insert', desc: p.description, tracking: p.tracking || '', must_return: p.requires_return === true });
        if (!dry) { if (await sins(base, H, 'job_part', ins)) out.inserted++; }
        else out.inserted++;
        continue;
      }

      // Fill blanks + the ship_* columns we own. Never clobber a human's fields.
      const patch = {};
      const dirty = /part\s*#|\n/i.test(String(row.number || ''));
      if (dirty || !row.number) { patch.number = p.part; }
      if (!String(row.name || '').trim() && p.description) patch.name = p.description;
      if (p.tracking && row.ship_tracking !== p.tracking) patch.ship_tracking = p.tracking;
      if (p.carrier && !row.ship_carrier) patch.ship_carrier = p.carrier;
      // Only ever SET an obligation, never clear one: a later note that omits the flag must not
      // quietly drop a part off the returns list.
      if (p.requires_return === true && row.must_return !== true) patch.must_return = true;
      else if (p.requires_return === false && row.must_return == null) patch.must_return = false;

      if (!Object.keys(patch).length) { out.unchanged++; continue; }
      if (patch.must_return === true) out.must_return_flagged++;
      jobRes.actions.push({ part: p.part, action: dirty ? 'repair+update' : 'update', fields: Object.keys(patch) });
      if (!dry) {
        if (await spatch(base, H, `job_part?id=eq.${row.id}`, patch)) { out.updated++; if (dirty) out.repaired++; }
      } else { out.updated++; if (dirty) out.repaired++; }
      if (p.tracking) touchedByTracking.push({ tracking: p.tracking });
    }
    out.results.push(jobRes);
  }

  out.tracking_numbers = Array.from(trackingSeen);

  // ── ETA: turn tracking numbers into "is it here yet" ──────────────────────
  // Best-effort on purpose. The parts LIST is the load-bearing half; if the carrier lookup is
  // down or a number is not FedEx, the tech still sees what was sent and its tracking number.
  if (out.tracking_numbers.length) {
    try {
      if (await fedex.configured()) {
        const r = await fedex.track(out.tracking_numbers.slice(0, 30));
        const packs = ((r.data && r.data.output && r.data.output.completeTrackResults) || []);
        const statuses = [];
        for (const t of packs) {
          const tr = (t.trackResults && t.trackResults[0]) || {};
          const st = tr.latestStatusDetail || {};
          const label = st.statusByLocale || st.description || '';
          if (!label) continue;
          const delivered = /delivered/i.test(label) || String(st.code || '') === 'DL';
          const when = (tr.dateAndTimes && (tr.dateAndTimes.find((x) => /ACTUAL_DELIVERY/.test(x.type)) || tr.dateAndTimes.find((x) => /ESTIMATED_DELIVERY/.test(x.type)) || {}).dateTime) || null;
          statuses.push({ tracking: t.trackingNumber, label, delivered, when });
          if (!dry) {
            await spatch(base, H, `job_part?ship_tracking=eq.${encodeURIComponent(t.trackingNumber)}`, {
              ship_status: label, ship_delivered: delivered,
              ship_status_at: new Date().toISOString(),
              ...(when ? { eta: String(when).slice(0, 10) } : {}),
            });
          }
        }
        out.shipments = statuses;
        out.shipments_delivered = statuses.filter((s) => s.delivered).length;
      } else { out.shipments = []; out.shipment_note = 'fedex_not_configured'; }
    } catch (e) { out.shipment_note = 'carrier_lookup_failed: ' + String((e && e.message) || e).slice(0, 100); }
  }

  console.log('[sp-parts-sync]', JSON.stringify({ dry, company: companyId, jobs: out.jobs_considered, with_parts: out.jobs_with_api_parts, ins: out.inserted, upd: out.updated, repaired: out.repaired, track: out.tracking_numbers.length }));
  return out;
}

// HTTP entry point. Kept SEPARATE from the cron on purpose: a Netlify fn that carries a
// `schedule` block edge-403s on every manual HTTP call (documented footgun), which would make
// the ?dry=1 shadow run -- the only way to eyeball this before it writes -- impossible.
// The schedule lives on platform-sp-parts-sync-cron instead.
exports.handler = async function (event) {
  const q = { ...(event.queryStringParameters || {}) };
  const guard = (await getSecret('ADMIN_SECRET')) || (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });
  return json(200, await runSync(q));
};

exports.runSync = runSync;
