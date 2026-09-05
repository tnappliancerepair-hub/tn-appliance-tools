// platform-tn-intake-tee — copy TN's customer INTAKE assets from legacy Xano onto the
// ANT Platform tenant, in parallel with Xano (a real backup "just in case").
//
// READ-ONLY toward Xano (Xano stays system of record). Only WRITES into the platform
// Supabase (TN's tenant, service key). Joins on xano_id (the platform mirror stamps every
// job with its Xano id; unique on company_id,xano_id) so each asset lands on the right job.
//
// What it tees (availability already rides platform-tn-mirror -> job.availability):
//   • VIDEO   — Xano job_attachments cfstream:<uid> -> job_media {provider:cfstream}     (no copy;
//               TN's Cloudflare account == the platform's, so the uid plays as-is)
//   • PHOTOS  — Xano job_attachments S3/cfimg -> bytes copied to platform R2 -> job_media {provider:r2}
//   • WAIVER  — event_log customer_waiver_signed -> job.waiver_name / waiver_signed_at / waiver_ack
//               + a thread_message summary (the liability record: release + hose + leak-kit choices).
//               Signature IMAGE: read from jobs.waiver_signature_b64 IF present (see note), -> R2 ->
//               job.waiver_signature_ref. (save_customer_waiver does not store the drawn image in the
//               DB today — it emails it to the waiver inbox; add the column + one-line XS edit to
//               capture new signatures' images here. Historical images live in the email archive.)
//
// Idempotent: job_media upserts on (company_id,ref) [migration 052]; waiver patches are
// naturally idempotent; deterministic R2 keys mean a re-copy overwrites the same object.
//
//   GET ?secret=<admin>                         -> forward run (recent media + recent waivers)
//   GET ?secret=…&dryrun=1                       -> list what WOULD land, copy/write nothing
//   GET ?secret=…&mode=backfill_media&page=P     -> walk ALL attachments (id asc), returns next_page
//   GET ?secret=…&mode=backfill_waiver&page=P    -> walk ALL waiver events (id asc), returns next_page
//   Tunables (vault): PLATFORM_INTAKE_TEE_ENABLED=false (kill), PLATFORM_INTAKE_TEE_FWD_MEDIA (fwd media rows, default 200),
//     PLATFORM_INTAKE_TEE_FWD_WAIVER (fwd waiver rows, default 100), PLATFORM_INTAKE_TEE_PHOTO_CAP (photo copies/call, default 40)
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');
const r2 = require('./_lib/r2');
let sdkS3 = null; try { sdkS3 = require('@aws-sdk/client-s3'); } catch (_) {}

const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';   // TN Appliance Exchange LLC (keeper)
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const T_ATTACH = 22;   // job_attachments
const T_EVENT = 3;     // event_log
const T_JOBS = 7;      // jobs

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// ── Xano metadata read (vault-first token, like platform-tn-mirror.fetchTdrMap) ──
async function xanoToken() { return (await getSecret('XANO_METADATA_TOKEN')) || process.env.XANO_METADATA_TOKEN || ''; }
async function xanoSearch(tableId, body) {
  const token = await xanoToken();
  if (!token) throw new Error('XANO_METADATA_TOKEN missing');
  const r = await fetch(`${META}/table/${tableId}/content/search`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`xano_${tableId}_${r.status}`);
  return (await r.json()).items || [];
}

// ── Platform Supabase (service key) ──
async function platformCfg() {
  const url = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url, key };
}
function pf(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    async get(path) { const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(10000) }); return r.ok ? r.json() : []; },
    async patch(path, row) { const r = await fetch(`${base}/rest/v1/${path}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(10000) }); return r.ok; },
    async insert(table, row) { const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(10000) }); return r.ok; },
    // Upsert media on the (company_id,ref) unique index -> idempotent (no dup on re-run).
    async upsertMedia(rows) {
      if (!rows.length) return 0;
      const r = await fetch(`${base}/rest/v1/job_media?on_conflict=company_id,ref`, {
        method: 'POST',
        headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) { const d = await r.text().catch(() => ''); throw new Error('media_upsert_' + r.status + '_' + d.slice(0, 160)); }
      return rows.length;
    },
  };
}

// Map a batch of Xano job_ids -> platform job UUIDs (one query). Returns Map<xanoId, uuid>.
async function resolveJobs(db, xanoIds) {
  const out = new Map();
  const ids = [...new Set(xanoIds.filter((n) => Number(n) > 0))];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const rows = await db.get(`job?company_id=eq.${TN_COMPANY}&xano_id=in.(${chunk.join(',')})&select=id,xano_id`);
    (rows || []).forEach((r) => out.set(Number(r.xano_id), r.id));
  }
  return out;
}

// ── legacy TN S3 read (photos) -> Buffer ──
function tnS3() {
  if (!sdkS3) return null;
  const region = process.env.TN_AWS_S3_REGION, ak = process.env.TN_AWS_ACCESS_KEY_ID, sk = process.env.TN_AWS_SECRET_ACCESS_KEY;
  if (!region || !ak || !sk) return null;
  return new sdkS3.S3Client({ region, credentials: { accessKeyId: ak, secretAccessKey: sk } });
}
async function fetchPhotoBytes(s3Key) {
  const key = String(s3Key || '');
  if (key.indexOf('cfimg:') === 0) {            // Cloudflare-image: ref is a public URL
    const r = await fetch(key.slice(6), { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('cfimg_' + r.status);
    return { buf: Buffer.from(await r.arrayBuffer()), ct: r.headers.get('content-type') || 'image/jpeg' };
  }
  const s3 = tnS3();
  if (!s3) throw new Error('tn_s3_not_configured');
  const res = await s3.send(new sdkS3.GetObjectCommand({ Bucket: process.env.TN_AWS_S3_BUCKET, Key: key }));
  const bytes = await res.Body.transformToByteArray();
  const lk = key.toLowerCase();
  const ct = lk.endsWith('.png') ? 'image/png' : (lk.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
  return { buf: Buffer.from(bytes), ct };
}
function extFor(s3Key, ct) {
  const lk = String(s3Key || '').toLowerCase();
  if (lk.endsWith('.png') || /png/.test(ct || '')) return 'png';
  if (lk.endsWith('.webp') || /webp/.test(ct || '')) return 'webp';
  return 'jpg';
}

// Classify an attachment row. Returns {kind:'video'|'photo'|'skip', reason?}.
function classify(a) {
  const key = String(a.s3_key || '');
  const ft = String(a.file_type || '').toLowerCase();
  if (!a.job_id || Number(a.job_id) <= 0) return { kind: 'skip', reason: 'no_job' };
  if (key.indexOf('cfstream:') === 0 || ft === 'video') return { kind: 'video' };
  if (ft === 'signature') return { kind: 'skip', reason: 'tech_signoff' };   // tech on-glass signoff, not customer intake
  if (!key) return { kind: 'skip', reason: 'no_key' };
  return { kind: 'photo' };
}

// ── MEDIA pass ──
// rows: array of Xano job_attachments. Copies video refs + photo bytes onto the platform.
async function mediaPass(db, rows, dry, photoCap) {
  const res = { scanned: rows.length, videos: 0, photos: 0, skipped: 0, no_job: 0, errors: 0, sample: [] };
  const jobMap = await resolveJobs(db, rows.map((a) => Number(a.job_id)));
  const mediaRows = [];
  let photosCopied = 0;
  for (const a of rows) {
    const c = classify(a);
    if (c.kind === 'skip') { res.skipped++; if (c.reason === 'no_job') res.no_job++; continue; }
    const pjob = jobMap.get(Number(a.job_id));
    if (!pjob) { res.no_job++; res.skipped++; continue; }   // platform job not mirrored yet -> catch next cycle
    if (c.kind === 'video') {
      const uid = String(a.s3_key || '').replace(/^cfstream:/, '');
      if (!uid) { res.skipped++; continue; }
      if (dry) { res.videos++; if (res.sample.length < 8) res.sample.push({ job: a.job_id, kind: 'video', ref: uid }); continue; }
      mediaRows.push({ company_id: TN_COMPANY, job_id: pjob, kind: 'video', provider: 'cfstream', ref: uid, label: String(a.file_name || 'Problem video').slice(0, 80) });
      res.videos++;
      continue;
    }
    // photo
    if (photosCopied >= photoCap) { res.skipped++; continue; }   // bound byte-copies/call; grind continues next page
    const r2key = `${TN_COMPANY}/tee/${a.id}.${extFor(a.s3_key, '')}`;
    if (dry) { res.photos++; if (res.sample.length < 8) res.sample.push({ job: a.job_id, kind: 'photo', src: String(a.s3_key).slice(0, 60), dest: r2key }); continue; }
    try {
      const { buf, ct } = await fetchPhotoBytes(a.s3_key);
      await r2.put(r2key, buf, ct);
      mediaRows.push({ company_id: TN_COMPANY, job_id: pjob, kind: 'photo', provider: 'r2', ref: r2key, label: String(a.file_name || 'Photo').slice(0, 80) });
      res.photos++; photosCopied++;
    } catch (e) { res.errors++; if (res.sample.length < 8) res.sample.push({ job: a.job_id, error: String((e && e.message) || e).slice(0, 100) }); }
  }
  if (!dry && mediaRows.length) { try { await db.upsertMedia(mediaRows); } catch (e) { res.errors++; res.upsert_error = String((e && e.message) || e).slice(0, 160); } }
  return res;
}

// ── WAIVER pass ──
// events: array of Xano event_log rows (action customer_waiver_signed).
// sigimg: when true, also read jobs.waiver_signature_b64 per waiver and copy the drawn
// signature to R2 (only enable once save_customer_waiver stores it — else it's a wasted
// Xano read per waiver, since the column doesn't exist yet).
async function waiverPass(db, events, dry, sigimg) {
  const res = { scanned: events.length, records: 0, signatures: 0, no_job: 0, skipped: 0, errors: 0, sample: [] };
  // parse each event's metadata
  const parsed = events.map((e) => {
    let m = e.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    let ack = (m && m.acknowledgments) || null;
    if (typeof ack === 'string') { try { ack = JSON.parse(ack); } catch (_) { /* leave as string */ } }
    return { job_id: Number((m && m.job_id) || 0), name: String((m && m.signer_name) || ''), email: String((m && m.signer_email) || ''), signed_ms: Number((m && m.signed_at_ms) || 0), ack };
  }).filter((x) => x.job_id > 0);
  const jobMap = await resolveJobs(db, parsed.map((x) => x.job_id));
  for (const w of parsed) {
    const pjob = jobMap.get(w.job_id);
    if (!pjob) { res.no_job++; res.skipped++; continue; }
    if (dry) { res.records++; if (res.sample.length < 8) res.sample.push({ job: w.job_id, name: w.name, ack: w.ack && typeof w.ack === 'object' ? Object.keys(w.ack) : 'n/a' }); continue; }
    const patch = { waiver_signed_at: w.signed_ms > 0 ? new Date(w.signed_ms).toISOString() : new Date().toISOString() };
    if (w.name) patch.waiver_name = w.name.slice(0, 120);
    if (w.ack) patch.waiver_ack = w.ack;
    try {
      await db.patch(`job?id=eq.${pjob}`, patch);
      // human-readable liability note on the job thread
      let sum = '✍️ Release of liability signed';
      if (w.name) sum += ` by ${w.name}`;
      if (w.ack && typeof w.ack === 'object') {
        const bits = [];
        if (w.ack.wants_new_hoses) bits.push('wants new hoses'); else if (w.ack.hose_choice === 'no') bits.push('declined hoses');
        if (w.ack.wants_leak_kit) bits.push('wants leak-kit'); else if (w.ack.leak_kit_choice === 'no') bits.push('declined leak-kit');
        if (bits.length) sum += ' — ' + bits.join(', ');
      }
      await db.insert('thread_message', { company_id: TN_COMPANY, job_id: pjob, direction: 'in', channel: 'portal', sender: 'customer', body: sum.slice(0, 300) });
      res.records++;
      // signature IMAGE (best-effort): read jobs.waiver_signature_b64 if the XS was extended to store it.
      // Gated: skip the per-waiver Xano read entirely until that column exists (else pure overhead).
      if (sigimg) try {
        const jr = await xanoSearch(T_JOBS, { search: { id: w.job_id }, per_page: 1 });
        const b64 = jr && jr[0] && (jr[0].waiver_signature_b64 || jr[0].waiver_signature);
        if (b64 && typeof b64 === 'string' && b64.length > 40) {
          const raw = b64.replace(/^data:image\/[a-z]+;base64,/i, '');
          const buf = Buffer.from(raw, 'base64');
          const skey = `${TN_COMPANY}/waiver/${w.job_id}.png`;
          await r2.put(skey, buf, 'image/png');
          await db.patch(`job?id=eq.${pjob}`, { waiver_signature_ref: skey });
          res.signatures++;
        }
      } catch (_) { /* signature image is best-effort; the record is what matters */ }
    } catch (e) { res.errors++; if (res.sample.length < 8) res.sample.push({ job: w.job_id, error: String((e && e.message) || e).slice(0, 100) }); }
  }
  return res;
}

async function runTee(opts) {
  const t0 = Date.now();
  const o = opts || {};
  const dry = !!o.dry;
  const enabled = String((await getSecretFresh('PLATFORM_INTAKE_TEE_ENABLED')) || 'true').toLowerCase() !== 'false';
  if (!dry && !enabled) return { ok: true, disabled: true, note: 'PLATFORM_INTAKE_TEE_ENABLED=false' };

  const { url, key } = await platformCfg();
  if (!url || !key) return { ok: false, error: 'platform supabase not configured' };
  const db = pf(url, key);
  const photoCap = parseInt((await getSecretFresh('PLATFORM_INTAKE_TEE_PHOTO_CAP')) || '20', 10) || 20;
  // Only read+copy the drawn signature image once save_customer_waiver stores it in the DB
  // (jobs.waiver_signature_b64). Off by default so the waiver record still tees cleanly.
  const sigimg = String((await getSecretFresh('PLATFORM_INTAKE_TEE_SIGIMG')) || '').toLowerCase() === 'true';

  const out = { ok: true, dry, mode: o.mode || 'forward', ms: 0 };

  if (o.mode === 'backfill_media') {
    const page = Math.max(1, parseInt(o.page, 10) || 1);
    const per = Math.max(1, Math.min(parseInt(o.limit, 10) || 25, 200));
    const rows = await xanoSearch(T_ATTACH, { sort: { id: 'asc' }, per_page: per, page });
    out.media = await mediaPass(db, rows, dry, photoCap);
    out.page = page; out.next_page = rows.length >= per ? page + 1 : null; out.done = out.next_page === null;
  } else if (o.mode === 'backfill_waiver') {
    const page = Math.max(1, parseInt(o.page, 10) || 1);
    const per = Math.max(1, Math.min(parseInt(o.limit, 10) || 30, 200));
    const rows = await xanoSearch(T_EVENT, { search: { action: 'customer_waiver_signed' }, sort: { id: 'asc' }, per_page: per, page });
    out.waiver = await waiverPass(db, rows, dry, sigimg);
    out.page = page; out.next_page = rows.length >= per ? page + 1 : null; out.done = out.next_page === null;
  } else {
    // forward: newest attachments + newest waiver events (idempotent -> re-covering the window is cheap)
    const fwdMedia = parseInt((await getSecretFresh('PLATFORM_INTAKE_TEE_FWD_MEDIA')) || '60', 10) || 60;
    const fwdWaiver = parseInt((await getSecretFresh('PLATFORM_INTAKE_TEE_FWD_WAIVER')) || '25', 10) || 25;
    const aRows = await xanoSearch(T_ATTACH, { sort: { id: 'desc' }, per_page: Math.min(fwdMedia, 400) });
    out.media = await mediaPass(db, aRows, dry, photoCap);
    const wRows = await xanoSearch(T_EVENT, { search: { action: 'customer_waiver_signed' }, sort: { id: 'desc' }, per_page: Math.min(fwdWaiver, 200) });
    out.waiver = await waiverPass(db, wRows, dry, sigimg);
  }
  out.ms = Date.now() - t0;
  return out;
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });
  try {
    const out = await runTee({ dry: q.dryrun === '1', mode: q.mode || 'forward', page: q.page, limit: q.limit });
    return json(200, out);
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 300) });
  }
};

module.exports.runTee = runTee;
