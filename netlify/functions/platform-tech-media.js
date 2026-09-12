// platform-tech-media — a TECH adds his OWN photos + videos to a job (the shots he takes
// on site, separate from the customer's intake bundle). Same hosting as intake: photos in
// Supabase Storage, video on Cloudflare Stream. Auth is the tech's Supabase session token,
// verified server-side; writes go through the platform service key and are scoped to the
// tech's own shop + the job he's on. Media lands in job_media tagged "Tech photo/video".
//
//   POST ?do=photo         { job, access_token, data(base64 dataURL), label? } -> { ok, url }
//   POST ?do=stream_mint   { job, access_token, bytes, filename }  -> { ok, uploadUrl, uid }
//   POST ?do=stream_done   { job, access_token, uid, label? }      -> { ok }
//   POST ?do=delete_media  { job, access_token, id }               -> { ok }
//   POST ?do=waiver_sign   { job, access_token, name, data? }      -> { ok, signed_at }
//
// waiver_sign is the ON-SITE signature: the tech hands his phone over, the customer draws
// their name with a finger, and we store the drawn image next to the signed-at stamp. It
// writes with the service key (so an RLS gate can never silently swallow it) and confirms a
// row came back before it reports success.
'use strict';

const { getSecret } = require('./_lib/secrets');
const r2 = require('./_lib/r2');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function b64(str) { return Buffer.from(String(str), 'utf8').toString('base64'); }

async function cfg() {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url: String(url).replace(/\/+$/, ''), key };
}
function rest(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    async get(path) { const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(8000) }); return r.ok ? r.json() : []; },
    async insert(table, row) { const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) }); return r.ok; },
    // NOTE the name. This used to be a second `patch`, which JS silently resolved to the
    // (path, row) version below -- so every 3-arg call sent a JSON *string* as the body of an
    // UNFILTERED PATCH. PostgREST rejected the string so nothing was ever written, but the
    // merge it was supposed to do never happened either. Two methods, two names, no shadowing.
    async patchWhere(table, filter, patchObj) { const r = await fetch(`${base}/rest/v1/${table}?${filter}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(patchObj), signal: AbortSignal.timeout(8000) }); return r.ok; },
    // Insert and hand back the row -- `insert` returns only ok, so a caller that needs the new
    // id (two-shot flows: shoot the part, then attach its receipt) has to use this one.
    async insertRet(table, row) {
      const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const out = await r.json().catch(() => []);
      return Array.isArray(out) ? (out[0] || null) : (out || null);
    },
    async storagePut(bucket, path, buf, contentType) {
      const r = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': contentType, 'x-upsert': 'true' }, body: buf, signal: AbortSignal.timeout(15000) });
      return r.ok;
    },
    async patch(path, row) {
      const r = await fetch(`${base}/rest/v1/${path}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const out = await r.json().catch(() => []);
      return Array.isArray(out) ? out : [];
    },
    async del(path) { const r = await fetch(`${base}/rest/v1/${path}`, { method: 'DELETE', headers: { ...H, Prefer: 'return=minimal' }, signal: AbortSignal.timeout(8000) }); return r.ok; },
    async storageDelete(bucket, objPath) { try { await fetch(`${base}/storage/v1/object/${bucket}/${objPath}`, { method: 'DELETE', headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(8000) }); } catch (_) {} },
  };
}

// Verify the tech's session token -> the auth user id (Supabase /auth/v1/user).
async function authUser(base, key, accessToken) {
  if (!accessToken) return null;
  try {
    const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: 'Bearer ' + accessToken }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.id) ? u : null;
  } catch (_) { return null; }
}

// Resolve the caller to a job they may touch: their app_user -> company_id, then confirm the
// job is in that company. Returns { company_id } or null. Service-key reads, session-verified.
async function scopeToJob(db, authId, jobId) {
  if (!authId || !jobId) return null;
  const us = await db.get(`app_user?auth_user_id=eq.${authId}&select=company_id,name&limit=1`);
  const companyId = us && us[0] && us[0].company_id;
  if (!companyId) return null;
  const js = await db.get(`job?id=eq.${jobId}&select=id,customer_id&company_id=eq.${companyId}&limit=1`);
  if (!js || !js[0]) return null;
  return { company_id: companyId, tech_name: (us[0].name || ''), customer_id: js[0].customer_id };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const p = Object.assign({}, body, q);
  const doo = String(q.do || p.do || '');
  const jobId = String(p.job || '').trim();
  const token = String(p.access_token || '').trim();

  const { url, key } = await cfg();
  if (!url || !key) return json(200, { ok: false, error: 'platform_not_configured' });
  const db = rest(url, key);

  const u = await authUser(url, key, token);
  if (!u) return json(200, { ok: false, error: 'not_signed_in' });
  const scope = await scopeToJob(db, u.id, jobId);
  if (!scope) return json(200, { ok: false, error: 'not_your_job' });

  try {
    if (doo === 'photo') {
      const data = String(p.data || '');
      const m = data.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
      if (!m) return json(400, { ok: false, error: 'bad image' });
      const contentType = m[1];
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 6 * 1024 * 1024) return json(400, { ok: false, error: 'image too large' });
      const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
      const path = `${scope.company_id}/${jobId}/tech-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
      try { await r2.put(path, buf, contentType); } catch (e) { return json(200, { ok: false, error: 'upload_failed' }); }
      await db.insert('job_media', { company_id: scope.company_id, job_id: jobId, kind: 'photo', provider: 'r2', ref: path, label: String(p.label || 'Tech photo').slice(0, 80) });
      let signed = ''; try { signed = await r2.presignGet(path, 600); } catch (_) {}
      return json(200, { ok: true, url: signed, path });
    }

    // ── ON-SITE SIGNATURE (the customer signs on the tech's phone) ───────────────
    // The tech hands the phone over; the customer draws their name. We keep the drawn
    // image (R2) AND the typed name AND the stamp, written with the service key so an
    // RLS gate can't silently drop it — and we only report success once a row comes back.
    // The signature is deliberately NOT added to job_media: techs count their job photos
    // ("you should have 7 total"), and a signature in that gallery breaks the count.
    if (doo === 'waiver_sign') {
      const name = String(p.name || '').trim().slice(0, 120);
      if (!name) return json(400, { ok: false, error: 'name_required' });

      // Drawn signature is best-effort: if the image fails to store we still record the
      // signing (name + timestamp). Never lose the release over a storage hiccup.
      let ref = null;
      const m = String(p.data || '').match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
      if (m) {
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length <= 2 * 1024 * 1024) {
          const path = `${scope.company_id}/${jobId}/waiver-${Date.now()}.png`;
          try { await r2.put(path, buf, m[1]); ref = path; } catch (_) { ref = null; }
        }
      }

      const signedAt = new Date().toISOString();
      const row = {
        waiver_signed_at: signedAt,
        waiver_name: name,
        waiver_ack: {
          release: 'agreed', signed_by: name, drawn: !!ref,
          on_site: true, signed_with: 'tech_device',
          witnessed_by: scope.tech_name || null, at: signedAt,
        },
      };
      if (ref) row.waiver_signature_ref = ref;

      const saved = await db.patch(`job?id=eq.${jobId}&company_id=eq.${scope.company_id}`, row);
      if (!saved || !saved.length) return json(200, { ok: false, error: 'not_saved' });

      // Office-visible proof in the shared thread.
      try {
        await db.insert('thread_message', {
          company_id: scope.company_id, customer_id: scope.customer_id, job_id: jobId,
          direction: 'out', channel: 'note',
          sender: 'tech' + (scope.tech_name ? ':' + scope.tech_name : ''),
          body: '\u270d\ufe0f Release of liability signed on site by ' + name + (ref ? ' (signature captured)' : ''),
        });
      } catch (_) { /* the release is saved; the note is a nicety */ }

      return json(200, { ok: true, signed_at: signedAt, name, signature: !!ref });
    }

    if (doo === 'stream_mint') {
      const acct = await getSecret('CLOUDFLARE_ACCOUNT_ID');
      const ctok = await getSecret('CLOUDFLARE_STREAM_TOKEN');
      if (!acct || !ctok) return json(200, { ok: false, error: 'video_not_configured' });
      const bytes = parseInt(p.bytes, 10);
      if (!bytes || bytes < 1) return json(400, { ok: false, error: 'bytes required' });
      const meta = ['name ' + b64(String(p.filename || 'tech.mp4').slice(0, 100)), 'maxDurationSeconds ' + b64('600')].join(',');
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/stream?direct_user=true`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctok}`, 'Tus-Resumable': '1.0.0', 'Upload-Length': String(bytes), 'Upload-Metadata': meta },
      });
      const uid = r.headers.get('stream-media-id') || '';
      const uploadUrl = r.headers.get('location') || '';
      if (!uploadUrl) { let d = ''; try { d = await r.text(); } catch (_) {} return json(200, { ok: false, error: 'cf_no_location', status: r.status, detail: d.slice(0, 200) }); }
      return json(200, { ok: true, uploadUrl, uid });
    }

    if (doo === 'stream_done') {
      const uid = String(p.uid || '').trim().slice(0, 120);
      if (!uid) return json(400, { ok: false, error: 'uid required' });
      await db.insert('job_media', { company_id: scope.company_id, job_id: jobId, kind: 'video', provider: 'cfstream', ref: uid, label: String(p.label || 'Tech video').slice(0, 80) });
      return json(200, { ok: true });
    }

    if (doo === 'delete_media') {
      const id = String(p.id || '').trim();
      if (!id) return json(400, { ok: false, error: 'id required' });
      const rows = await db.get(`job_media?id=eq.${id}&job_id=eq.${jobId}&company_id=eq.${scope.company_id}&select=id,provider,ref&limit=1`);
      const row = rows && rows[0];
      if (!row) return json(200, { ok: false, error: 'not_found' });
      // best-effort remove the underlying asset, then the row
      if (row.provider === 'r2' && row.ref) { try { await r2.del(row.ref); } catch (_) {} }
      if (row.provider === 'storage' && row.ref) { await db.storageDelete('intake-photos', row.ref); }
      if (row.provider === 'cfstream' && row.ref) {
        try {
          const acct = await getSecret('CLOUDFLARE_ACCOUNT_ID');
          const ctok = await getSecret('CLOUDFLARE_STREAM_TOKEN');
          if (acct && ctok) await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/stream/${encodeURIComponent(row.ref)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ctok}` }, signal: AbortSignal.timeout(8000) });
        } catch (_) {}
      }
      const ok = await db.del(`job_media?id=eq.${id}&company_id=eq.${scope.company_id}`);
      return json(200, { ok });
    }

    // Snap-a-photo → OCR the part # → log a warranty RETURN. The tech taps the camera on a
    // SquareTrade/Allstate job, shoots each unused part, and this stores the photo + reads the
    // part number off it + files a job_part disposition='return' row — no typing. If OCR can't
    // read the #, the return is STILL logged with the photo (the photo is the record; the office
    // reads the # off it). Merges onto an existing part row on the job when the # matches, so a
    // pre-supplied part isn't duplicated.
    // ── A part the tech went and BOUGHT (parts house / Home Depot / anywhere) ────────────
    // Teddy 2026-09-11: snap the part AND the receipt. This is the one case where the shop is
    // out real cash, so the receipt is the cost of record: it prices the customer's line (cost
    // x the owner's margin), it is the tech's reimbursement, and it is the books' entry.
    //   POST { job, access_token, data, kind:'part'|'receipt', part_id? }
    // Two shots, one row: the part shot creates the row and returns its id, the receipt shot
    // attaches to that id. Either can stand alone -- a receipt with no readable part still
    // records the money, which is the half that cannot be reconstructed later.
    if (doo === 'bought_part') {
      const data = String(p.data || '');
      const m = data.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
      if (!m) return json(400, { ok: false, error: 'bad image' });
      const contentType = m[1];
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 6 * 1024 * 1024) return json(400, { ok: false, error: 'image too large' });
      const isReceipt = String(p.kind || '').toLowerCase() === 'receipt';
      const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
      const path = `${scope.company_id}/${jobId}/${isReceipt ? 'receipt' : 'bought'}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
      try { await r2.put(path, buf, contentType); } catch (e) { return json(200, { ok: false, error: 'upload_failed' }); }
      await db.insert('job_media', { company_id: scope.company_id, job_id: jobId, kind: 'photo', provider: 'r2', ref: path, label: isReceipt ? 'Parts receipt' : 'Part picked up' });

      // Who picked it up — for reimbursement, and so the office knows who to ask.
      let who = '';
      try {
        const tr = await db.get(`technician?id=eq.${scope.technician_id}&company_id=eq.${scope.company_id}&select=name&limit=1`);
        who = (tr && tr[0] && tr[0].name) || '';
      } catch (_) {}

      let ocr = {};
      try {
        const o = require('./platform-ocr');
        const or = await o.handler({ httpMethod: 'POST', body: JSON.stringify({ data, mode: isReceipt ? 'receipt' : 'part' }) });
        const od = JSON.parse(or.body || '{}');
        if (od && od.ok) ocr = od;
      } catch (_) {}

      const normP = (s2) => String(s2 || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const nowIso = new Date().toISOString();

      // ---- receipt shot: attach the money to a row ----
      if (isReceipt) {
        const patch = {
          receipt_ref: path,
          bought_at: nowIso,
          bought_by: who || null,
        };
        if (ocr.store) { patch.bought_from = ocr.store; patch.source = ocr.store; }
        // Only take a cost we actually believe. A low-confidence read, or a receipt covering
        // more than this one part, is left for a human rather than silently mispriced.
        const trust = ocr.cost_cents && ocr.confidence !== 'low' && !ocr.multi_item;
        if (trust) patch.cost_cents = ocr.cost_cents;

        let targetId = String(p.part_id || '').trim();
        if (!targetId && ocr.part_number) {
          try {
            const ex2 = await db.get(`job_part?job_id=eq.${jobId}&company_id=eq.${scope.company_id}&select=id,number&limit=200`);
            const hit = (ex2 || []).find((r) => normP(r.number) === normP(ocr.part_number));
            if (hit) targetId = hit.id;
          } catch (_) {}
        }
        if (targetId) {
          await db.patchWhere('job_part', `id=eq.${targetId}&company_id=eq.${scope.company_id}`, patch);
        } else {
          targetId = null;
          const row = await db.insertRet('job_part', Object.assign({
            company_id: scope.company_id, job_id: jobId,
            number: ocr.part_number || null,
            name: ocr.part_description || 'Part picked up',
            order_status: 'ordered', ship_to: 'shop',
          }, patch));
          targetId = (row && row.id) || null;
        }
        return json(200, {
          ok: true, kind: 'receipt', part_id: targetId, ref: path,
          store: ocr.store || '', cost_cents: trust ? ocr.cost_cents : null,
          // say WHY we didn't take the number, so the tech isn't left guessing
          needs_review: !trust,
          review_reason: !ocr.cost_cents ? 'couldn_t_read_a_price'
            : (ocr.multi_item ? 'receipt_covers_more_than_this_part' : (ocr.confidence === 'low' ? 'unclear_photo' : '')),
          order_total_cents: ocr.order_total_cents || null,
        });
      }

      // ---- part shot: create (or merge onto) the row ----
      const pn = String(ocr.part_number || '').toUpperCase().trim();
      let partId = null;
      if (pn) {
        try {
          const ex2 = await db.get(`job_part?job_id=eq.${jobId}&company_id=eq.${scope.company_id}&select=id,number,photo_ref&limit=200`);
          const hit = (ex2 || []).find((r) => normP(r.number) === normP(pn));
          if (hit) {
            const patch = { bought_at: nowIso, bought_by: who || null };
            if (!hit.photo_ref) patch.photo_ref = path;
            await db.patchWhere('job_part', `id=eq.${hit.id}&company_id=eq.${scope.company_id}`, patch);
            partId = hit.id;
          }
        } catch (_) {}
      }
      if (!partId) {
        const row = await db.insertRet('job_part', {
          company_id: scope.company_id, job_id: jobId,
          number: pn || null,
          name: ocr.part_description || 'Part picked up',
          photo_ref: path, order_status: 'ordered', ship_to: 'shop',
          bought_at: nowIso, bought_by: who || null,
        });
        partId = (row && row.id) || null;
      }
      return json(200, { ok: true, kind: 'part', part_id: partId, ref: path, part_number: pn, confidence: ocr.confidence || '' });
    }

    if (doo === 'return_part') {
      const data = String(p.data || '');
      const m = data.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
      if (!m) return json(400, { ok: false, error: 'bad image' });
      const contentType = m[1];
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 6 * 1024 * 1024) return json(400, { ok: false, error: 'image too large' });
      const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
      const path = `${scope.company_id}/${jobId}/return-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
      try { await r2.put(path, buf, contentType); } catch (e) { return json(200, { ok: false, error: 'upload_failed' }); }
      await db.insert('job_media', { company_id: scope.company_id, job_id: jobId, kind: 'photo', provider: 'r2', ref: path, label: 'Warranty return part' });

      // OCR the part # (in-process, part mode) — never blocks logging the return.
      let pn = '', desc = '', conf = '', ocrOk = false;
      try {
        const ocr = require('./platform-ocr');
        const or = await ocr.handler({ httpMethod: 'POST', body: JSON.stringify({ data, mode: 'part' }) });
        const od = JSON.parse(or.body || '{}');
        if (od && od.ok) { ocrOk = true; pn = String(od.part_number || '').toUpperCase().trim(); desc = String(od.part_description || '').trim(); conf = String(od.confidence || ''); }
      } catch (_) {}

      const normP = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const npn = normP(pn);

      // Merge onto an existing part on this job when the # matches (don't dup a pre-supplied part).
      let merged = false;
      if (npn) {
        try {
          const existing = await db.get(`job_part?job_id=eq.${jobId}&company_id=eq.${scope.company_id}&select=id,number,photo_ref&limit=200`);
          const hit = (existing || []).find((r) => normP(r.number) === npn);
          if (hit) {
            const patch = { disposition: 'return', returned_at: null };
            if (!hit.photo_ref) patch.photo_ref = path;
            merged = await db.patchWhere('job_part', `id=eq.${hit.id}&company_id=eq.${scope.company_id}`, patch);
          }
        } catch (_) {}
      }

      if (!merged) {
        // Source = the shop's warranty company (the distributor it goes back to), best-effort.
        let source = '';
        try { const jr = await db.get(`job?id=eq.${jobId}&company_id=eq.${scope.company_id}&select=warranty_company&limit=1`); source = (jr && jr[0] && jr[0].warranty_company) || ''; } catch (_) {}
        await db.insert('job_part', {
          company_id: scope.company_id, job_id: jobId,
          number: pn, name: desc || 'Unused part',
          disposition: 'return', source: source || null, photo_ref: path,
        });
      }
      return json(200, { ok: true, merged, ocr_ok: ocrOk, part_number: pn, part_description: desc, confidence: conf, photo: path });
    }

    return json(200, { ok: false, error: 'unknown do' });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
