// nsa-parts-watch — NSA's half of the parts loop: what they SHIP us, and what they want BACK.
//
// WHY THIS EXISTS. Measured 2026-09-11 on the platform, NSA jobs:
//
//     35 parts / 17 jobs   0 with tracking   0 flagged owed-back
//
// Same shape the AHS audit found the same day: the parts are on the tickets, but nothing
// ever recorded that a shipment was on the way, and nothing ever recorded that NSA wants
// any of it back. Both facts arrive by email, from ONE sender, and nobody was reading them.
//
// NSA's terms are the third distinct flavour of the same chargeback:
//
//                  SquareTrade        AHS                       NSA
//   label          prepaid FedEx      none - we pay freight     prepaid (tracking given)
//   clock          not stated         "within 10 days", fixed   ROLLING age, 31 days
//   dollar         "may be charged"   "$295.74 deducted"        stated in the email? NO
//   mechanism      per part           per PO                    per part, auto-deducted
//
// So NSA states the CLOCK but not the DOLLAR, exactly inverted from AHS, which states the
// dollar but only per-PO. Both land as must_return + a deadline; returns.html already
// renders a null penalty as "no stated $", which is honest rather than a zero.
//
// TWO PASSES, ONE GMAIL READ. Both notices come from the same sender, so one fan-out serves
// both. That matters: the multi-account fan-out is the flaky, eventually-consistent part of
// this whole pipeline (documented - the same query has returned 30, then 0, then 4 within
// minutes), so halving the number of reads halves the exposure.
//
//   PASS 1  "HIS Parts Shipped for Case# H4441313"
//           -> "4 HIS parts for Case# H4441313 have shipped via tracking number 522944922847"
//           ONE tracking number for the whole shipment, a part COUNT, and NO part numbers.
//           So this cannot be matched per part. It stamps the shipment onto the job's
//           untracked rows - and refuses to guess when the counts disagree (below).
//
//   PASS 2  "NSA Action Needed - Potential Parts Charge" (weekly, Wednesdays)
//           A table of EVERY unreturned part on the account, with a rolling Age in days.
//           "When the age reaches 31 days our system will automatically charge you for the
//           part by deducting the cost from future payments."  -> due = notice date + (30 - age).
//
// THE JOIN KEY, verified against live data before any of this was written: the notice's
// "Case#" is job.claim_number verbatim, in every format NSA uses - H4441313 (Hisense),
// NSA010566012401 (ARW), PRN011699941401, and bare digits like 74889. Sampled cases all
// resolved to a real NSA job. A case can cover several machines, so we prefer the sibling
// that already carries the part, same as the AHS watcher.
//
// DELIBERATELY DOES NOT TOUCH disposition. Migration 064 is explicit: must_return is the
// VENDOR's rule, disposition is what the TECH did. NSA proves why in the wild - its digest
// lists parts with Return Reason "Parts Installed", i.e. the part WAS used and the core is
// still owed back. Every one of those rows reads disposition='used' on the platform, so
// keying the obligation off disposition would erase the exact ones that cost money.
//
//   GET ?secret=<admin>&dryrun=1[&days=45]   parse + match, write nothing
//   GET ?secret=<admin>[&days=45]            stamp shipments + obligations
//   Kill switches: vault NSA_PARTS_WATCH_ENABLED=false  (whole thing)
//                        NSA_SHIPPED_ENABLED=false      (pass 1 only)
//                        NSA_RETURNS_ENABLED=false      (pass 2 only)
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');
const { readMany } = require('./_lib/gmail-accounts');
const crud = require('./_lib/xano/metadata-crud');
// "is this row the same physical part" -- shared with platform-sp-parts-sync and
// ahs-returns-watch. The legacy rows carry descriptive junk in .number ("Washer Lid Lock
// Part #WH01X24387", "BT68-135 | Thermal Overload Protector -- QTY: 1 Sh..."), so a straight
// compare matches nothing and inserts a DUPLICATE of a part the job already has.
const { rowMatches } = require('./_lib/part-match');

const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';   // TN Appliance Exchange LLC (keeper)
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const SENDER_DEFAULT = 'notifications@em.nationalservicealliance.com';
const CHARGE_AT_DAYS = 31;                                    // "when the age reaches 31 days"

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function ymd(ms) { return new Date(ms).toISOString().slice(0, 10); }

// Carrier from the tracking shape. NSA says "fedex" in the digest, but the shipped notice
// gives a bare number, so infer it rather than assert a carrier we weren't told.
function carrierOf(tracking) {
  const t = String(tracking || '').replace(/\s+/g, '');
  if (/^1Z[0-9A-Z]{16}$/i.test(t)) return 'UPS';
  if (/^\d{20,22}$/.test(t)) return 'USPS';
  if (/^\d{12}$|^\d{15}$/.test(t)) return 'FedEx';
  return '';
}

// ── PASS 1 parser: "HIS Parts Shipped for Case# X" ───────────────────────────
// "4 HIS parts for Case# H4441313 have shipped via tracking number 522944922847"
// "1 HIS part for Case# H4437394 has shipped via tracking number 541270047357"
function parseShippedNotice(subject, body) {
  const t = String(body || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const s = String(subject || '');
  if (!/Parts Shipped for Case/i.test(s) && !/Repair Parts Have Shipped/i.test(t)) return null;

  const m = t.match(/(\d{1,3})\s+\S+\s+parts?\s+for\s+Case#\s*([A-Za-z0-9._\-]+)\s+(?:have|has)\s+shipped\s+via\s+tracking\s+number\s+([A-Za-z0-9]{8,})/i);
  const caseNo = (m && m[2]) || (s.match(/Case#\s*([A-Za-z0-9._\-]+)/i) || [])[1] || '';
  if (!caseNo) return null;
  const tracking = (m && m[3]) || (t.match(/tracking\s+number\s+([A-Za-z0-9]{8,})/i) || [])[1] || '';
  const count = m ? (parseInt(m[1], 10) || 0) : 0;
  return { case_no: String(caseNo).trim(), count, tracking: String(tracking).trim(), carrier: carrierOf(tracking) };
}

// ── PASS 2 parser: the weekly "Potential Parts Charge" table ─────────────────
// SIX <td> cells, each STACKING three values separated by <br>:
//   0 Case# / Last Name / Phone      3 RMA Sent Date / Return Tracking / ShippingCo
//   1 PartAcct / Part# / Desc        4 Return Reason / Has Core
//   2 Qty / Each / Extend            5 Age
// It MUST be parsed from the raw HTML. Tag-stripping collapses the empty sub-values
// ("1<br><br>" -> "1"), which silently shifts every column after a blank Each/RMA cell --
// that is exactly why readMany is asked for .html here.
function cellParts(td) {
  return String(td || '')
    .replace(/<\/?(p|div)[^>]*>/gi, '<br>')
    .split(/<br\s*\/?>/i)
    .map((x) => x.replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ').trim());
}
function money(s) {
  const m = String(s || '').match(/([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
  if (!m) return null;
  const v = Math.round(parseFloat(m[1].replace(/,/g, '')) * 100);
  return Number.isFinite(v) && v > 0 ? v : null;
}
function parseChargeDigest(html) {
  const out = [];
  const src = String(html || '');
  const tb = (src.match(/<tbody[\s\S]*?<\/tbody>/i) || [src])[0];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(tb))) {
    const tds = [];
    const tdRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let td;
    while ((td = tdRe.exec(tr[1]))) tds.push(cellParts(td[1]));
    if (tds.length < 6) continue;                                   // header row has <th>, not <td>
    const [c0, c1, c2, c3, c4, c5] = tds;
    const ageRaw = String(c5[0] || '').trim();
    if (!c0[0] || !/^\d+$/.test(ageRaw)) continue;                  // no case# / no age -> not a data row
    out.push({
      case_no: c0[0], last_name: c0[1] || '', phone: c0[2] || '',
      part_acct: c1[0] || '', part: c1[1] || '', desc: c1[2] || '',
      qty: parseInt(c2[0], 10) || 1, each_cents: money(c2[1]), extend_cents: money(c2[2]),
      rma_sent: c3[0] || '', tracking: c3[1] || '', shipco: c3[2] || '',
      reason: c4[0] || '', has_core: /^y|core|true/i.test(c4[1] || ''),
      age: parseInt(ageRaw, 10),
    });
  }
  return out;
}

// ── platform rest ────────────────────────────────────────────────────────────
function pf(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  const u = (p) => `${base}/rest/v1/${p}`;
  return {
    async get(p) { try { const r = await fetch(u(p), { headers: H, signal: AbortSignal.timeout(12000) }); return r.ok ? await r.json() : []; } catch (_) { return []; } },
    async patch(table, filter, row) { try { const r = await fetch(u(`${table}?${filter}`), { method: 'PATCH', headers: Object.assign({ Prefer: 'return=minimal' }, H), body: JSON.stringify(row), signal: AbortSignal.timeout(12000) }); return r.ok; } catch (_) { return false; } },
    async insert(table, row) { try { const r = await fetch(u(table), { method: 'POST', headers: Object.assign({ Prefer: 'return=minimal' }, H), body: JSON.stringify(row), signal: AbortSignal.timeout(12000) }); return r.ok; } catch (_) { return false; } },
  };
}

const last10 = (s) => String(s || '').replace(/\D/g, '').slice(-10);

// One NSA case resolves to SEVERAL job rows -- verified on live data: claim NSA010566012401
// has EIGHT, all the same human (DAVIS, 615-889-9517) with eight separately-minted customer
// rows. That is the documented warranty-intake dedup bug, not eight different people, so the
// join key is safe; but seven of the eight are nameless shells, and dropping the obligation
// on one of those puts it on a card the office can't identify.
//
// The digest hands us the last name AND the phone, so use them. Preference order:
//   1. the sibling that already carries this part          (unambiguous)
//   2. a sibling whose customer matches the notice's phone / last name
//   3. a sibling whose customer is a REAL record, not a shell (has a first name)
//   4. live > completed > canceled, then newest
// `who` is optional -- the shipped notice carries no name, so it falls through to 3/4.
async function resolveJob(db, caseNo, partNos, who) {
  const c = String(caseNo || '').trim(); if (!c) return null;
  const sel = 'id,status,created_at,customer:customer_id(first_name,last_name,phone)';
  const jobs = await db.get(`job?company_id=eq.${TN_COMPANY}&claim_number=eq.${encodeURIComponent(c)}&select=${encodeURIComponent(sel)}&limit=30`);
  if (!Array.isArray(jobs) || !jobs.length) return null;
  if (jobs.length === 1) return jobs[0].id;

  const wanted = (partNos || []).filter(Boolean);
  if (wanted.length) {
    const rows = await db.get(`job_part?job_id=in.(${jobs.map((j) => j.id).join(',')})&select=job_id,number,name&limit=400`);
    for (const r of (Array.isArray(rows) ? rows : [])) {
      for (const w of wanted) if (rowMatches(r, w)) return r.job_id;
    }
  }

  const wantPhone = last10((who && who.phone) || '');
  const wantLast = String((who && who.last_name) || '').trim().toLowerCase();
  const score = (j) => {
    const cu = j.customer || {};
    let n = 0;
    if (wantPhone && last10(cu.phone) === wantPhone) n += 4;
    if (wantLast && String(cu.last_name || '').trim().toLowerCase() === wantLast) n += 2;
    if (String(cu.first_name || '').trim()) n += 1;          // a real record, not a shell
    return n;
  };
  const rank = (s) => (s === 'canceled' ? 3 : (s === 'completed' ? 2 : 1));
  return jobs.slice().sort((a, b) =>
    (score(b) - score(a)) ||
    (rank(a.status) - rank(b.status)) ||
    (String(b.created_at || '').localeCompare(String(a.created_at || '')))
  )[0].id;
}

async function runNsaParts(opts = {}) {
  const dry = !!opts.dry;
  const days = Math.max(1, Math.min(180, parseInt(opts.days, 10) || 45));

  const enabled = String((await getSecretFresh('NSA_PARTS_WATCH_ENABLED')) || 'true').toLowerCase() !== 'false';
  if (!dry && !enabled) return { ok: true, disabled: true, note: 'NSA_PARTS_WATCH_ENABLED=false' };
  const doShip = String((await getSecretFresh('NSA_SHIPPED_ENABLED')) || 'true').toLowerCase() !== 'false';
  const doRet = String((await getSecretFresh('NSA_RETURNS_ENABLED')) || 'true').toLowerCase() !== 'false';

  const base = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!base || !key) return { ok: false, error: 'platform_not_configured' };
  const db = pf(base, key);

  const sender = (await getSecretFresh('NSA_PARTS_WATCH_SENDER')) || SENDER_DEFAULT;
  let msgs = [];
  // NARROW THE QUERY TO THE TWO SUBJECTS. This sender also blasts dispatches, update
  // requests and EFT registers, so `from:` alone pulls hundreds across four inboxes and
  // the full-format fetch blows the 26s cap. Scoping to the two subjects takes the pull
  // from 40+ to ~10. Verified all three Gmail OR spellings return the same set.
  const q = `from:${sender} newer_than:${days}d (subject:"Parts Shipped for Case" OR subject:"Potential Parts Charge")`;
  // .html because the charge digest is a POSITIONAL table -- see parseChargeDigest.
  try { msgs = await readMany(q, { max: 40, html: true }); }
  catch (e) { return { ok: false, error: 'gmail read failed: ' + String((e && e.message) || e) }; }
  // The multi-account fan-out is eventually-consistent -- the SAME query has returned 40
  // then 0 back-to-back. Reporting `scanned` is what makes a dead read visible instead of
  // looking exactly like "no notices"; hourly + idempotent is what makes it self-heal.
  if (!msgs.length) return Object.assign({ ok: true, mode: dry ? 'dryrun' : 'live', scanned: 0, note: 'no messages returned — empty inbox OR a flaky fan-out read; hourly + idempotent self-heals' }, {});

  const res = {
    ok: true, mode: dry ? 'dryrun' : 'live', window_days: days,
    scanned: msgs.length,
    scanned_distinct: new Set(msgs.map((m) => (m.subject || '') + '|' + (m.date || ''))).size,
    shipped: { notices: 0, jobs_matched: 0, parts_tracked: 0, no_rows_on_job: 0, count_mismatch: 0, already_tracked: 0, unmatched_case: 0, errors: 0 },
    returns: { digests_seen: 0, digest_date: '', rows: 0, flagged: 0, created: 0, already_returned: 0, unmatched_case: 0, errors: 0, no_longer_listed: 0, no_longer_listed_samples: [] },
    samples: [],
  };
  const sample = (o) => { if (res.samples.length < 14) res.samples.push(o); };

  // ── PASS 1 — parts being SENT ──────────────────────────────────────────────
  if (doShip) {
    // The SAME NSA email lands in more than one connected inbox, and their Gmail ids differ,
    // so the fan-out hands us each notice twice. Dedupe on the NATURAL key (case + tracking)
    // rather than on a message id -- a shipment is one shipment however many inboxes saw it.
    const seenShip = new Set();
    for (const m of msgs) {
      let n = null;
      try { n = parseShippedNotice(m.subject || '', m.body || ''); } catch (_) { n = null; }
      if (!n || !n.tracking) continue;
      const key = n.case_no + '|' + n.tracking;
      if (seenShip.has(key)) continue;
      seenShip.add(key);
      res.shipped.notices++;
      const atMs = Date.parse(m.date || '') || Date.now();

      const jobId = await resolveJob(db, n.case_no, []);
      if (!jobId) {
        res.shipped.unmatched_case++;
        sample({ pass: 'shipped', outcome: 'no_job_for_case', case: n.case_no, count: n.count, tracking: n.tracking });
        if (!dry) { try { await crud.logEvent('warranty_part_unmatched', { vendor: 'NSA', claim: n.case_no, parts: [], tracking: n.tracking, carrier: n.carrier, count: n.count, source: 'nsa_parts_shipped', at_ms: Date.now() }); } catch (_) {} }
        continue;
      }
      res.shipped.jobs_matched++;

      let rows = [];
      try { rows = await db.get(`job_part?job_id=eq.${jobId}&company_id=eq.${TN_COMPANY}&select=id,number,name,ship_tracking&limit=200`); } catch (_) { rows = []; }
      const untracked = (rows || []).filter((r) => !r.ship_tracking);
      const tracked = (rows || []).length - untracked.length;

      // The notice names NO part numbers -- only "N parts, one tracking number". So the
      // shipment can only be attributed to rows we already hold.
      if (!untracked.length) {
        if (tracked) { res.shipped.already_tracked++; }
        else {
          // Nothing on the ticket to attach it to. Don't invent part rows from a count --
          // a row with no part number is noise on the tech card and the customer portal.
          res.shipped.no_rows_on_job++;
          sample({ pass: 'shipped', outcome: 'no_part_rows_on_job', job_id: jobId, case: n.case_no, count: n.count, tracking: n.tracking });
          if (!dry) { try { await crud.logEvent('warranty_part_unmatched', { vendor: 'NSA', claim: n.case_no, job_id: jobId, parts: [], tracking: n.tracking, carrier: n.carrier, count: n.count, reason: 'no_part_rows_on_job', source: 'nsa_parts_shipped', at_ms: Date.now() }); } catch (_) {} }
        }
        continue;
      }
      // More untracked rows than the notice shipped -> we cannot tell WHICH ones came in
      // this box, and stamping all of them would assert a shipment that didn't happen.
      if (n.count && untracked.length > n.count) {
        res.shipped.count_mismatch++;
        sample({ pass: 'shipped', outcome: 'count_mismatch_not_stamped', job_id: jobId, case: n.case_no, notice_count: n.count, untracked_rows: untracked.length, tracking: n.tracking });
        if (!dry) { try { await crud.logEvent('warranty_part_unmatched', { vendor: 'NSA', claim: n.case_no, job_id: jobId, parts: [], tracking: n.tracking, carrier: n.carrier, count: n.count, untracked_rows: untracked.length, reason: 'count_mismatch', source: 'nsa_parts_shipped', at_ms: Date.now() }); } catch (_) {} }
        continue;
      }

      for (const r of untracked) {
        if (dry) { res.shipped.parts_tracked++; sample({ pass: 'shipped', outcome: 'would_track', job_id: jobId, case: n.case_no, part: r.number, tracking: n.tracking, carrier: n.carrier }); continue; }
        const ok = await db.patch('job_part', `id=eq.${r.id}&company_id=eq.${TN_COMPANY}`, {
          ship_tracking: n.tracking,
          ship_carrier: n.carrier || null,
          ship_status: 'shipped',
          ship_status_at: new Date(atMs).toISOString(),
        });
        ok ? res.shipped.parts_tracked++ : res.shipped.errors++;
      }
    }
  }

  // ── PASS 2 — parts owed BACK ───────────────────────────────────────────────
  // The digest is FULL STATE: every unreturned part on the account, as of that Wednesday.
  // So only the NEWEST one may be applied. Replaying a 30-day window of them would
  // resurrect obligations that were settled and have since dropped off the list.
  if (doRet) {
    const digests = msgs
      .filter((m) => /Potential Parts Charge/i.test(m.subject || ''))
      .sort((a, b) => (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0));
    res.returns.digests_seen = digests.length;

    const newest = digests[0] || null;
    if (newest) {
      const noticeMs = Date.parse(newest.date || '') || Date.now();
      res.returns.digest_date = ymd(noticeMs);
      // The digest is weekly, so its AGE is part of the reading. An old newest-digest means
      // either NSA went quiet because nothing is owed, or we stopped receiving them. We
      // still apply it -- on this money the expensive direction is showing nothing while a
      // deduction lands, and a settled row costs the office one tap -- but the staleness
      // has to be visible rather than implied.
      res.returns.digest_age_days = Math.round((Date.now() - noticeMs) / 86400000);
      let rows = [];
      try { rows = parseChargeDigest(newest.html || ''); } catch (_) { rows = []; }
      res.returns.rows = rows.length;

      // Compare on PART IDENTITY, not row id. A row we CREATE this run gets no id back
      // (Prefer: return=minimal), so an id-based set counts the part we just flagged as
      // "no longer listed" -- the watcher reporting its own write as a discrepancy.
      const listedParts = [];
      for (const r of rows) {
        const jobId = await resolveJob(db, r.case_no, [r.part], { phone: r.phone, last_name: r.last_name });
        if (!jobId) {
          res.returns.unmatched_case++;
          sample({ pass: 'returns', outcome: 'no_job_for_case', case: r.case_no, part: r.part, name: r.last_name, age: r.age });
          if (!dry) { try { await crud.logEvent('warranty_part_unmatched', { vendor: 'NSA', claim: r.case_no, parts: [{ number: r.part, description: r.desc }], age_days: r.age, reason_text: r.reason, source: 'nsa_charge_digest', at_ms: Date.now() }); } catch (_) {} }
          continue;
        }

        // "When the age reaches 31 days our system will automatically charge you" -- so the
        // last safe day is notice date + (30 - age). Past 30 it lands in the past, which is
        // the truth and renders as OVERDUE.
        const dueAt = Number.isFinite(r.age) ? ymd(noticeMs + (CHARGE_AT_DAYS - 1 - r.age) * 86400000) : null;

        let existing = [];
        try { existing = await db.get(`job_part?job_id=eq.${jobId}&company_id=eq.${TN_COMPANY}&select=id,number,name,source,returned_at,must_return&limit=200`); } catch (_) { existing = []; }
        const hit = (existing || []).find((x) => rowMatches(x, r.part)) || null;
        if (r.part) listedParts.push(r.part);

        if (hit && hit.returned_at) { res.returns.already_returned++; continue; }   // office already closed it

        const stamp = {
          must_return: true,
          return_due_at: dueAt,
          // NSA does not state the dollar in this email (Each/Extend are blank on every
          // notice sampled). Leave it null rather than invent a zero -- returns.html shows
          // the clock and simply omits the money, which is honest.
          return_penalty_cents: r.extend_cents || r.each_cents || null,
        };
        // The digest's own column header calls this "Return Tracking". Stored as given.
        // NOTE for whoever fixes the FedEx Track 403: confirm the direction before letting
        // fedex-returns-autoclose act on an NSA-sourced return_tracking -- if it turned out
        // to be the INBOUND number, auto-close would clear an obligation on arrival.
        if (r.tracking) { stamp.return_tracking = r.tracking; stamp.return_carrier = r.shipco || carrierOf(r.tracking) || null; }

        if (dry) {
          res.returns[hit ? 'flagged' : 'created']++;
          sample({ pass: 'returns', outcome: hit ? 'would_flag' : 'would_create', job_id: jobId, case: r.case_no, part: r.part, desc: r.desc, age: r.age, due: dueAt, reason: r.reason, core: r.has_core });
          continue;
        }
        if (hit) {
          const ok = await db.patch('job_part', `id=eq.${hit.id}&company_id=eq.${TN_COMPANY}`, stamp);
          ok ? res.returns.flagged++ : res.returns.errors++;
        } else {
          const ok = await db.insert('job_part', Object.assign({
            company_id: TN_COMPANY, job_id: jobId,
            number: r.part,
            name: r.desc || (r.has_core ? 'Core' : 'Warranty part'),
            source: r.part_acct ? ('NSA ' + r.part_acct) : 'NSA',
          }, stamp));
          ok ? res.returns.created++ : res.returns.errors++;
        }
      }

      // Parts WE still show as owed that NSA's newest list no longer names. Almost certainly
      // returned and settled. REPORTED, never auto-cleared: a stale row costs the office one
      // tap, and a wrongly-cleared one costs the part. Flip it on only once this has been
      // watched for a few weeks.
      if (rows.length) {
        let owed = [];
        try {
          owed = await db.get(`job_part?company_id=eq.${TN_COMPANY}&must_return=is.true&returned_at=is.null&select=id,number,name,job:job_id(claim_number,warranty_company)&limit=400`);
        } catch (_) { owed = []; }
        for (const o of (Array.isArray(owed) ? owed : [])) {
          const wc = String((o.job && o.job.warranty_company) || '');
          if (!/nsa|national service/i.test(wc)) continue;
          if (listedParts.some((w) => rowMatches(o, w))) continue;
          res.returns.no_longer_listed++;
          if (res.returns.no_longer_listed_samples.length < 10) {
            res.returns.no_longer_listed_samples.push({ part_id: o.id, part: o.number, claim: (o.job && o.job.claim_number) || '' });
          }
        }
      }
    }
  }

  return res;
}

exports.config = { timeout: 26 };
exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== guard) return json(403, { ok: false, error: 'forbidden — ?secret=' });
  const res = await runNsaParts({ dry: q.dryrun === '1', days: q.days });
  return json(200, res);
};
exports.runNsaParts = runNsaParts;
exports.parseShippedNotice = parseShippedNotice;
exports.parseChargeDigest = parseChargeDigest;
exports.carrierOf = carrierOf;
