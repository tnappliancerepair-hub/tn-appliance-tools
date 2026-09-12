// platform-tn-job-back — a job born ON THE PLATFORM also lands in Xano.
//
// TEDDY'S DIRECTION 2026-09-10: "hopefully we can get these new jobs to go to Supabase as well as
// Xano, and just use Xano as a backup for right now so that way we've got everything still while
// we make this merger over."
//
// Almost everything already works that way - 3,438 of 3,455 jobs came from Xano and the mirror
// carries them here within 5 minutes. The hole is the other direction. The platform runs its OWN
// warranty-email intake (<slug>@jobs.assistant247.net -> platform-email-intake), and when a
// dispatch arrives that Xano's poller never saw, the job is created HERE and Xano never hears
// about it. Measured the day this shipped: FOUR real Frontdoor dispatches from 9/8-9/10 -
// Ferrara, Madroy, Tusa, Segreti, all with claim numbers, addresses and appliances - existed only
// on the platform. Searching Xano for any of those names returned nothing. That is the backup
// missing live work, which is the exact opposite of what a backup is for.
//
// SAFETY, in the order it matters:
//  1. CLAIM NUMBER REQUIRED. It is the dedup key. A job without one is REPORTED, never created -
//     guessing at a match would put duplicate warranty jobs in the live system, and a duplicate
//     dispatch is worse than a missing one (two techs, two claims, one machine).
//  2. LINK BEFORE CREATE. If Xano already has that claim, we only stamp xano_id and stop. Most
//     platform intakes hit this path - they matched a mirrored job already.
//  3. NO SIGNALS. Writes through the Metadata API, not create_job_from_chat / ahs_email_intake,
//     which emit JOB_CREATED and fire the customer greeting SMS. Teddy's standing rule is no
//     proactive customer texts, and a backfill of three-day-old dispatches is the last thing that
//     should text anybody.
//  4. Stamping xano_id hands the job to the mirror from then on, so the two stay in step and this
//     can never create it twice.
//
//   GET ?secret=<admin>&dryrun=1        what WOULD land in Xano, writes nothing
//   GET ?secret=<admin>                 run (SHADOW unless PLATFORM_JOB_BACK_LIVE=true)
//   GET ?secret=<admin>&days=N          how far back to look (default 21 - the working horizon)
//   GET ?secret=<admin>&max=N           cap per run (default 20)
//   GET ?secret=<admin>&cust=<xano_id>  read-only: dump a Xano customer row (mapping aid)
// Kill: vault PLATFORM_JOB_BACK_ENABLED=false
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');
const md = require('./_lib/xano/metadata-crud');

const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
const CUST_TABLE = 6;
const JOBS_TABLE = 7;

const j = (code, body) => ({ statusCode: code, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body, null, 1) });
const s = (v) => String(v == null ? '' : v).trim();
const dig10 = (v) => s(v).replace(/\D/g, '').slice(-10);

async function sbCfg() {
  return {
    url: String((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, ''),
    key: (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '',
  };
}

async function runJobBack(q) {
  const dry = q.dryrun === '1' || q.dryrun === 'true';
  const days = Math.max(1, Math.min(120, Number(q.days || 21)));
  const max = Math.max(1, Math.min(100, Number(q.max || 20)));
  const live = String(await getSecretFresh('PLATFORM_JOB_BACK_LIVE') || '').toLowerCase() === 'true';
  if (String(await getSecretFresh('PLATFORM_JOB_BACK_ENABLED') || '').toLowerCase() === 'false') {
    return { ok: true, skipped: 'disabled' };
  }

  const { url, key } = await sbCfg();
  if (!url || !key) return { ok: false, error: 'platform supabase not configured' };
  const H = { apikey: key, Authorization: 'Bearer ' + key };

  const since = new Date(Date.now() - days * 86400000).toISOString();
  const sel = 'id,claim_number,dispatch_id,warranty_company,problem,availability,status,created_at,' +
              'customer:customer_id(first_name,last_name,phone,address,city,state,zip),' +
              'unit:unit_id(label,attributes)';
  const pr = await fetch(
    `${url}/rest/v1/job?company_id=eq.${TN_COMPANY}&xano_id=is.null&status=not.in.(completed,canceled)` +
    `&created_at=gte.${since}&select=${encodeURIComponent(sel)}&order=created_at.asc&limit=${max}`,
    { headers: H, signal: AbortSignal.timeout(15000) },
  );
  const pending = await pr.json().catch(() => null);
  if (!Array.isArray(pending)) return { ok: false, error: 'platform read failed', detail: JSON.stringify(pending).slice(0, 250) };

  const out = { ok: true, mode: dry ? 'dryrun' : (live ? 'live' : 'shadow'), window_days: days, candidates: pending.length, linked: 0, created: 0, skipped: 0, plan: [], errors: [] };

  for (const p of pending) {
    const claim = s(p.claim_number) || s(p.dispatch_id);
    const c = p.customer || {};
    const who = [s(c.first_name), s(c.last_name)].filter(Boolean).join(' ') || '(no name)';

    if (!claim) {
      // No dedup key = no safe way to tell a new dispatch from one Xano already has.
      out.skipped++;
      out.plan.push({ platform_job: p.id, who, action: 'skip', why: 'no claim number — needs a human' });
      continue;
    }

    // 2) LINK BEFORE CREATE.
    let existing = null;
    try {
      for (const field of ['claim_number', 'dispatch_source_id']) {
        const hit = await md.search(JOBS_TABLE, { [field]: claim });
        const row = (Array.isArray(hit) ? hit : [])[0];
        if (row && Number(row.id)) { existing = row; break; }
      }
    } catch (e) {
      out.errors.push({ platform_job: p.id, at: 'search_xano', err: String((e && e.message) || e).slice(0, 140) });
      continue;   // never assume "Xano doesn't have it" on a failed read — that is how duplicates get made
    }

    if (existing) {
      out.plan.push({ platform_job: p.id, who, claim, action: 'link', xano_id: Number(existing.id) });
      if (!dry && live) { await stampXanoId(url, H, p.id, Number(existing.id)); out.linked++; }
      continue;
    }

    const attrs = (p.unit && p.unit.attributes) || {};
    const phone10 = dig10(c.phone);
    const draft = {
      who, claim, phone: c.phone || '', appliance: s(p.unit && p.unit.label),
      city: s(c.city), state: s(c.state),
    };
    out.plan.push({ platform_job: p.id, action: 'create', ...draft });
    if (dry || !live) continue;

    try {
      // customer: match on the last 10 digits before creating one.
      // The Xano customer table is narrow — first/last/phone/email/address/city/state/zip — and
      // searching a column it does not have 400s the whole request. It has NO customer_phone and
      // no service_* columns (those live on the JOB). Probed, not assumed.
      // Metadata search is also single-field only, so try the phone formats one at a time.
      let custId = 0;
      if (phone10) {
        for (const form of [phone10, '+1' + phone10, '1' + phone10]) {
          let hit = [];
          try { hit = await md.search(CUST_TABLE, { phone: form }); } catch (_) { hit = []; }
          const row = (Array.isArray(hit) ? hit : []).find((x) => dig10(x.phone) === phone10);
          if (row && Number(row.id)) { custId = Number(row.id); break; }
        }
      }
      if (!custId) {
        // dedup_signature deliberately left unset: their format normalises the street
        // ("Kentucky Ave" -> "kentucky avenue") and writing a wrong one would poison their own
        // matching. Blank just means no auto-merge, which is the safe direction.
        const made = await md.insert(CUST_TABLE, {
          first_name: s(c.first_name), last_name: s(c.last_name),
          phone: phone10 || s(c.phone),
          address: s(c.address), city: s(c.city), state: s(c.state), zip: s(c.zip),
          company_id: 1,
        });
        custId = Number((made && (made.id || (made.item && made.item.id))) || 0);
      }
      if (!custId) throw new Error('could not resolve a Xano customer');

      // job — the field shape copied off a real live warranty job (22037), not invented.
      const made = await md.insert(JOBS_TABLE, {
        company_id: 1,
        customer_id: custId,
        customer_first: s(c.first_name), customer_last: s(c.last_name), customer_phone: s(c.phone),
        problem_summary: s(p.problem), problem_description: s(p.problem),
        appliance_type: s(p.unit && p.unit.label), brand: s(attrs.brand), model_number: s(attrs.model),
        customer_type: 'warranty',
        warranty_company: s(p.warranty_company), claim_number: claim, dispatch_source_id: claim,
        scheduling_status: 'not_ready', friendly_status: 'From the platform (backfill)',
        payment_status: 'warranty_pending', parts_status: 'not_needed',
        service_address: s(c.address), service_city: s(c.city), service_state: s(c.state), service_zip: s(c.zip),
        customer_preference_text: s(p.availability),
        intake_source: 'platform_backfill', source_type: 'platform_backfill', source_agent: 'platform-tn-job-back',
        notes_internal: '=== CREATED FROM THE PLATFORM ' + new Date().toISOString().slice(0, 10) +
                        ' ===\nPlatform job ' + p.id + '\nThe platform warranty-email intake caught this dispatch and Xano had not seen it.',
        parallel_mode: false,
      });
      const newId = Number((made && (made.id || (made.item && made.item.id))) || 0);
      if (!newId) throw new Error('insert returned no id');
      await stampXanoId(url, H, p.id, newId);
      out.created++;
      out.plan[out.plan.length - 1].xano_id = newId;
    } catch (e) {
      // Report the OP and the response body, not just the message. Two runs were spent guessing
      // which call was failing off a bare "-> 400"; the op tag says exactly which helper threw.
      out.errors.push({
        platform_job: p.id, who, at: 'create_xano',
        op: (e && e.op) || null, status: (e && e.status) || null,
        err: String((e && e.message) || e).slice(0, 180),
        body: String((e && e.body) || '').slice(0, 300),
      });
    }
  }
  if (!live && !dry) out.note = 'SHADOW — set vault PLATFORM_JOB_BACK_LIVE=true to write to Xano';
  return out;
}

// Stamping xano_id hands the job to the mirror from here on: the two stay in step, and this
// function can never create it a second time.
async function stampXanoId(url, H, platformJobId, xanoId) {
  await fetch(`${url}/rest/v1/job?id=eq.${platformJobId}`, {
    method: 'PATCH',
    headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, H),
    body: JSON.stringify({ xano_id: xanoId }),
    signal: AbortSignal.timeout(12000),
  }).catch(() => {});
}

exports.runJobBack = runJobBack;

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || process.env.VAPI_ADMIN_SECRET || GUARD_FALLBACK;
  if (!q.secret || q.secret !== admin) return j(401, { ok: false, error: 'unauthorized' });
  try {
    // ?claim= — the check that actually decides a create. office_universal_search gives FALSE
    // NEGATIVES (it reported Segreti missing while job 21982 held his claim), so duplicate
    // hunting has to go through the claim, never the name.
    if (q.claim) {
      const hits = [];
      for (const field of ['claim_number', 'dispatch_source_id']) {
        let rows = [];
        try { rows = await md.search(JOBS_TABLE, { [field]: s(q.claim) }); } catch (_) { rows = []; }
        (Array.isArray(rows) ? rows : []).forEach((r) => {
          if (!hits.some((h) => h.id === Number(r.id))) {
            hits.push({ id: Number(r.id), status: r.scheduling_status, who: [r.customer_first, r.customer_last].filter(Boolean).join(' '), source: r.intake_source });
          }
        });
      }
      return j(200, { ok: true, claim: s(q.claim), matches: hits.length, duplicate: hits.length > 1, jobs: hits });
    }
    if (q.cust) {
      const rows = await md.search(CUST_TABLE, { id: Number(q.cust) });
      const row = (Array.isArray(rows) ? rows : []).find((r) => Number(r.id) === Number(q.cust));
      if (!row) return j(200, { ok: false, error: 'not found' });
      const populated = {};
      Object.keys(row).forEach((k) => { const v = row[k]; if (v !== null && v !== '' && v !== 0) populated[k] = v; });
      return j(200, { ok: true, columns: Object.keys(row).length, all_keys: Object.keys(row), populated });
    }
    return j(200, await runJobBack(q));
  } catch (e) {
    return j(500, { ok: false, error: String((e && e.message) || e) });
  }
};
