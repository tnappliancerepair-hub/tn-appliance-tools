// ahs-address-backfill — recover the REAL service address for jobs the AHS parser landed
// as "1, City" (street number only) or with a missing street. The truth is still in the
// dispatch XML sitting in Gmail (proved: job 20497 shows "1, New Orleans" but dispatch
// 65104189 carries "7221 & 7223 Yorktown Dr"). For each flagged AHS job this re-reads its
// dispatch, parses the full CoveredProperty address, and either shows the proposed fix
// (dry-run) or writes it onto the customer record (?apply=1, owner-gated).
//
// It also DIAGNOSES the root cause: if a job's own dispatch XML itself only carries "1"
// (a genuine AHS placeholder), it's marked dispatch_also_incomplete — the parser isn't at
// fault there, the source is, and it needs another channel (tenant/tech).
//
//   GET ?secret=<admin>                 -> dry-run, first batch (max 8), shows current vs proposed
//   GET ?secret=<admin>&max=8&offset=8  -> next batch
//   GET ?secret=<admin>&apply=1         -> WRITES the recoverable fixes for this batch
'use strict';

const { google } = require('googleapis');
const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');
const { officeTaskAlert } = require('./_lib/office-alert');
const SITE = 'https://tnapplianceexchange.net';
const OWNER = '+16154855795';
const CUSTOMER = crud.TABLES.customer; // 6
const JOBS = crud.TABLES.jobs;         // 7

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function decode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

// Pull the <CoveredProperty ...> opening tag's attributes into a full address.
function parseDispatchAddress(xml) {
  const m = String(xml || '').match(/<CoveredProperty[^>]*>/i);
  if (!m) return null;
  const attrs = {};
  let a; const re = /(\w+)="([^"]*)"/g;
  while ((a = re.exec(m[0]))) attrs[a[1]] = a[2];
  const num = decode(attrs.StreetNumber), dir = decode(attrs.StreetDirection), name = decode(attrs.StreetName);
  const utype = decode(attrs.UnitType), unum = decode(attrs.UnitNumber);
  let street = [num, dir, name].filter(Boolean).join(' ').trim();
  if (unum) street = (street + ' ' + [utype, unum].filter(Boolean).join(' ')).trim();
  return {
    street,
    city: decode(attrs.CityName),
    state: decode(attrs.StateCode),
    zip: decode(attrs.ZipPostCode),
    // the dispatch itself is incomplete only if it has no real street NAME
    complete: !!(name && name.replace(/[^a-z]/gi, '').length >= 2),
  };
}

function findXmlAtt(payload) {
  if (!payload) return null;
  for (const p of (payload.parts || [])) {
    const fn = (p.filename || '').toLowerCase();
    if ((fn.endsWith('.xml') || (p.mimeType || '').includes('xml')) && p.body && p.body.attachmentId) return p.body.attachmentId;
    const n = findXmlAtt(p); if (n) return n;
  }
  return null;
}

function b64(s) { try { return Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (_) { return ''; } }
// Flatten a Gmail message payload into plain text (Frontdoor dispatches carry the
// address in the BODY, not an XML attachment).
function getBodyText(payload) {
  let out = '';
  (function walk(p) {
    if (!p) return;
    const mt = (p.mimeType || '');
    if (p.body && p.body.data) {
      const txt = b64(p.body.data);
      if (mt.includes('text/plain')) out += ' ' + txt;
      else if (mt.includes('text/html')) out += ' ' + txt.replace(/<[^>]+>/g, ' ');
    }
    (p.parts || []).forEach(walk);
  })(payload);
  return out.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
const esc = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Parse the Frontdoor/AHS body "Address: <street> <city> <state> <zip>" line. We usually
// already know the correct city/state/zip (only the STREET got dropped to "1"), so anchor
// on the known city to cleanly isolate the street; fall back to a generic split otherwise.
function parseBodyAddress(text, known) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const city = (known && known.city) ? String(known.city).trim() : '';
  let street = '', pcity = city, pstate = (known && known.state) || '', pzip = (known && known.zip) || '';
  if (city) {
    const m = t.match(new RegExp('Address:\\s*(.+?)\\s+' + esc(city) + '\\s+([A-Za-z]{2})\\s+(\\d{5})', 'i'));
    if (m) { street = decode(m[1]).trim(); pstate = m[2].toUpperCase(); pzip = m[3]; }
  }
  if (!street) {
    const m = t.match(/Address:\s*(\d+\s+.+?)\s+([A-Za-z][A-Za-z .'-]*?)\s+([A-Za-z]{2})\s+(\d{5})/i);
    if (m) { street = decode(m[1]).trim(); pcity = decode(m[2]).trim(); pstate = m[3].toUpperCase(); pzip = m[4]; }
  }
  if (!street) return null;
  // a real street has a NAME (letters after the house number), not a bare "1"
  const nameOK = /[a-z]/i.test(street.replace(/^\d+\s*/, '')) && !/^\d+$/.test(street.trim());
  return { street, city: pcity, state: pstate, zip: pzip, complete: nameOK };
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  // Scheduled (cron) invocations carry {next_run} in the body — they self-authorize and
  // run in APPLY mode: the daily auto-heal safety-net for any "1, City" that slips past
  // the parser fix. Manual runs still need the admin secret.
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const apply = scheduled || q.apply === '1';
  const max = Math.min(parseInt(q.max, 10) || 8, 12);
  const offset = parseInt(q.offset, 10) || 0;

  // 1) Flagged jobs from the audit — the AHS ones with a claim# and a street problem.
  let flagged = [];
  try {
    const d = await (await fetch(`${SITE}/.netlify/functions/job-data-audit?full=1`, { signal: AbortSignal.timeout(30000) })).json();
    flagged = (d.flagged || []).filter((f) =>
      /ahs/i.test(f.warranty_company || '') &&
      f.claim_number &&
      f.issues.some((i) => i === 'street_number_only' || i === 'missing_street')
    );
  } catch (_) { return json(200, { ok: false, error: 'audit_unreachable' }); }

  const total = flagged.length;
  const batch = flagged.slice(offset, offset + max);

  // 2) Gmail client (same creds as ahs-xml-debug).
  const cid = process.env.GMAIL_CLIENT_ID, cs = process.env.GMAIL_CLIENT_SECRET, rt = process.env.GMAIL_REFRESH_TOKEN;
  if (!cid || !cs || !rt) return json(500, { ok: false, error: 'gmail_env_missing' });
  const oauth2 = new google.auth.OAuth2(cid, cs); oauth2.setCredentials({ refresh_token: rt });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const results = [];
  for (const f of batch) {
    const rec = { job_id: f.id, name: f.name, claim: f.claim_number, current: [f.street, f.city, f.state, f.zip].filter(Boolean).join(', ') || '(blank)' };
    try {
      // Search WITHOUT has:attachment so Frontdoor dispatches (address in the body,
      // no XML attachment) are found too — that class was silently un-healable before.
      const list = await gmail.users.messages.list({ userId: 'me', q: `${f.claim_number}`, maxResults: 5 });
      const msgs = (list.data.messages) || [];
      let parsed = null;
      for (const { id } of msgs) {
        const mm = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
        // (a) classic AHS XML attachment
        const att = findXmlAtt(mm.data.payload);
        if (att) {
          const a = await gmail.users.messages.attachments.get({ userId: 'me', messageId: id, id: att });
          const xml = Buffer.from(a.data.data, 'base64url').toString('utf8');
          const p = parseDispatchAddress(xml);
          if (p && p.complete) { parsed = p; break; }
          if (p && !parsed) parsed = p;
          continue;
        }
        // (b) Frontdoor body "Address:" line (no attachment)
        const pb = parseBodyAddress(getBodyText(mm.data.payload), { city: f.city, state: f.state, zip: f.zip });
        if (pb && pb.complete) { parsed = pb; break; }
        if (pb && !parsed) parsed = pb;
      }
      if (!parsed) { rec.status = 'no_dispatch_found'; results.push(rec); continue; }
      rec.proposed = [parsed.street, parsed.city, parsed.state, parsed.zip].filter(Boolean).join(', ');
      if (!parsed.complete) { rec.status = 'dispatch_also_incomplete'; results.push(rec); continue; }

      if (apply) {
        const custPatch = { address: parsed.street };
        if (parsed.city) custPatch.city = parsed.city;
        if (parsed.state) custPatch.state = parsed.state;
        if (parsed.zip) custPatch.zip = parsed.zip;
        if (f.customer_id) await crud.update(CUSTOMER, f.customer_id, custPatch);
        // keep the job's denormalized service_* in sync so the board reflects it.
        // CRITICAL: service_ADDRESS (the street) must be written too — the job file
        // displays the JOB's street, so without this the drawer kept showing the old
        // "1" even after a "FIXED" run (the real cause of "addresses messing up again").
        const jobPatch = { service_address: parsed.street };
        if (parsed.city) jobPatch.service_city = parsed.city;
        if (parsed.state) jobPatch.service_state = parsed.state;
        if (parsed.zip) jobPatch.service_zip = parsed.zip;
        await crud.update(JOBS, f.id, jobPatch);
        await crud.logEvent('ahs_address_backfill', { job_id: f.id, customer_id: f.customer_id, from: rec.current, to: rec.proposed, claim: f.claim_number });
        rec.status = 'FIXED';
      } else {
        rec.status = 'recoverable';
      }
    } catch (e) { rec.status = 'error'; rec.error = String(e.message || e).slice(0, 120); }
    results.push(rec);
  }

  const counts = results.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});

  // On a scheduled run that actually healed something, give the owner a quiet heads-up so
  // the auto-fix is visible (not silent). Stays quiet when there's nothing to fix.
  if (scheduled && counts.FIXED) {
    const fixedList = results.filter((r) => r.status === 'FIXED').map((r) => `#${r.job_id} ${r.name} -> ${r.proposed}`).join('\n');
    try { await officeTaskAlert(`[ant] 🛠️ Auto-fixed ${counts.FIXED} job address${counts.FIXED > 1 ? 'es' : ''} from the dispatch:\n${fixedList}`, 'address_autoheal'); } catch (_) {}   // → Danielle+Sofia, biz hours
  }

  return json(200, {
    ok: true,
    mode: apply ? 'APPLIED' : 'dry-run',
    total_flagged_ahs: total,
    batch: `${offset}-${offset + batch.length}`,
    next_offset: offset + batch.length < total ? offset + batch.length : null,
    counts,
    results,
  });
};
