// platform-intake — the customer INTAKE bundle for the platform. TN's proven intake
// magic, multi-tenant: one token (the portal_grant) opens a branded page where the
// customer gives availability + a video + model photos + signs the release of liability.
// Everything is written SERVER-SIDE with the platform service key (never in the browser);
// video rides Cloudflare Stream (weak-signal-proof, TN's account); photos land in a
// Supabase Storage bucket. See docs/sql/007_intake.sql + platform/intake.html.
//
//   GET  ?t=<token>&do=context                         -> shop + appliance + what's done
//   POST ?t=<token>&do=availability {availability, access_notes}
//   POST ?t=<token>&do=stream_upload {bytes, filename} -> { uploadUrl, uid, playback }
//   POST ?t=<token>&do=media {kind, provider, ref, label}
//   POST ?t=<token>&do=photo {data, filename}          -> uploads to Supabase Storage
//   POST ?t=<token>&do=waiver {name}
//   POST ?t=<token>&do=finish
'use strict';

const { getSecret } = require('./_lib/secrets');
let sms = null; try { sms = require('./_lib/sms'); } catch (_) {}
let shopsReg = null; try { shopsReg = require('./_lib/trial-shops'); } catch (_) {}
const SITE = 'https://tnapplianceexchange.net';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
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
    async patch(path, row) { const r = await fetch(`${base}/rest/v1/${path}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) }); return r.ok; },
    async insert(table, row) { const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) }); const d = await r.json().catch(() => null); if (!r.ok) throw new Error((d && d.message) || ('insert ' + r.status)); return Array.isArray(d) ? d[0] : d; },
    async storagePut(bucket, path, buf, contentType) {
      const r = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': contentType, 'x-upsert': 'true' }, body: buf, signal: AbortSignal.timeout(15000) });
      return r.ok;
    },
  };
}

// validate the intake token → the grant (company/customer/job)
async function grantFor(db, token) {
  if (!token) return null;
  const rows = await db.get(`portal_grant?token=eq.${encodeURIComponent(token)}&select=company_id,customer_id,job_id,revoked,expires_at&limit=1`);
  const g = rows && rows[0];
  if (!g || g.revoked) return null;
  if (g.job_id == null) return null; // intake needs a specific job
  if (g.expires_at && new Date(g.expires_at).getTime() < Date.now()) return null;
  return g;
}
async function note(db, g, body) {
  try { await db.insert('thread_message', { company_id: g.company_id, customer_id: g.customer_id, job_id: g.job_id, direction: 'in', channel: 'portal', sender: 'customer', body }); } catch (_) {}
}

// The moment the customer finishes intake, ping the SHOP with a link straight into the
// cockpit (platform/tech-job.html) — the customer's video + model photo are loaded, the
// model # is OCR-ready, part search is a tap away, and the TDR is right there to pre-
// diagnose. This is the hand-off: customer done -> shop opens ready to find the part.
// Sends as an internal 'office' alert (reliable line, no quiet-hours/rate gate). Best-effort.
async function notifyShopIntakeDone(db, base, g) {
  if (!sms) return;
  const cos = await db.get(`company?id=eq.${g.company_id}&select=slug,name,settings&limit=1`);
  const co = (cos && cos[0]) || {};
  const jobs = await db.get(`job?id=eq.${g.job_id}&select=problem,unit:unit_id(label)&limit=1`);
  const job = (jobs && jobs[0]) || {};
  const cus = await db.get(`customer?id=eq.${g.customer_id}&select=first_name,last_name&limit=1`);
  const c = (cus && cus[0]) || {};
  const who = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || 'The customer';
  const appliance = (job.unit && job.unit.label) || 'their appliance';
  // Owner notify number: company.settings first, then the trial-shops registry by slug.
  let ownerCell = (co.settings && (co.settings.owner_cell || co.settings.ownerCell || co.settings.notify_cell)) || '';
  if (!ownerCell && co.slug && shopsReg && shopsReg.getAsync) {
    try { const s = await shopsReg.getAsync(co.slug); ownerCell = (s && s.ownerCell) || ''; } catch (_) {}
  }
  if (!ownerCell) return;
  const cockpit = `${SITE}/platform/tech-job.html?job=${g.job_id}`;
  const msg = `✅ ${who} finished their intake for ${appliance} — video, model photo & availability are in. Open the cockpit to pre-diagnose + find the part: ${cockpit}`;
  try { await sms.sendSms(ownerCell, msg, 'office', 'intake_complete_cockpit'); } catch (_) {}
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const p = Object.assign({}, body, q);
  const doo = String(q.do || p.do || 'context');
  const token = String(q.t || p.t || '').trim();

  const { url, key } = await cfg();
  if (!url || !key) return json(200, { ok: false, error: 'platform_not_configured' });
  const db = rest(url, key);
  const g = await grantFor(db, token);
  if (!g) return json(200, { ok: false, error: 'This link is invalid or has expired.' });

  try {
    if (doo === 'context') {
      const jobs = await db.get(`job?id=eq.${g.job_id}&select=id,problem,availability,waiver_signed_at,intake_done_at,unit:unit_id(label,kind)&limit=1`);
      const job = (jobs && jobs[0]) || {};
      const cos = await db.get(`company?id=eq.${g.company_id}&select=name,trade,settings&limit=1`);
      const co = (cos && cos[0]) || {};
      const cus = await db.get(`customer?id=eq.${g.customer_id}&select=first_name&limit=1`);
      const media = await db.get(`job_media?job_id=eq.${g.job_id}&select=kind&limit=50`);
      const hasVideo = (media || []).some((m) => m.kind === 'video');
      const hasPhoto = (media || []).some((m) => m.kind === 'photo');
      return json(200, { ok: true,
        shop: { name: co.name, trade: co.trade, settings: co.settings || {} },
        first_name: (cus && cus[0] && cus[0].first_name) || '',
        appliance: (job.unit && job.unit.label) || '', problem: job.problem || '',
        done: { availability: !!job.availability, video: hasVideo, photo: hasPhoto, waiver: !!job.waiver_signed_at, finished: !!job.intake_done_at },
      });
    }

    if (doo === 'availability') {
      await db.patch(`job?id=eq.${g.job_id}`, { availability: String(p.availability || '').slice(0, 500), access_notes: String(p.access_notes || '').slice(0, 500) || null });
      await note(db, g, `📅 Availability: ${String(p.availability || '').slice(0, 300)}${p.access_notes ? ' · Access: ' + String(p.access_notes).slice(0, 200) : ''}`);
      return json(200, { ok: true });
    }

    if (doo === 'stream_upload') {
      const acct = await getSecret('CLOUDFLARE_ACCOUNT_ID');
      const ctok = await getSecret('CLOUDFLARE_STREAM_TOKEN');
      if (!acct || !ctok) return json(200, { ok: false, error: 'video_not_configured' });
      const bytes = parseInt(p.bytes, 10);
      if (!bytes || bytes < 1) return json(400, { ok: false, error: 'bytes required' });
      const meta = ['name ' + b64(String(p.filename || 'video.mp4').slice(0, 100)), 'maxDurationSeconds ' + b64('600')].join(',');
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/stream?direct_user=true`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctok}`, 'Tus-Resumable': '1.0.0', 'Upload-Length': String(bytes), 'Upload-Metadata': meta },
      });
      const uid = r.headers.get('stream-media-id') || '';
      const uploadUrl = r.headers.get('location') || '';
      if (!uploadUrl) { let d = ''; try { d = await r.text(); } catch (_) {} return json(200, { ok: false, error: 'cf_no_location', status: r.status, detail: d.slice(0, 200) }); }
      return json(200, { ok: true, uploadUrl, uid });
    }

    if (doo === 'media') {
      const kind = ['video', 'photo'].includes(String(p.kind)) ? String(p.kind) : 'photo';
      const provider = String(p.provider || (kind === 'video' ? 'cfstream' : 'storage'));
      const ref = String(p.ref || '').slice(0, 300);
      if (!ref) return json(400, { ok: false, error: 'ref required' });
      await db.insert('job_media', { company_id: g.company_id, job_id: g.job_id, kind, provider, ref, label: String(p.label || (kind === 'video' ? 'Problem video' : 'Photo')).slice(0, 80) });
      await note(db, g, kind === 'video' ? '🎥 Sent a video of the problem' : '📸 Sent a model-number photo');
      return json(200, { ok: true });
    }

    if (doo === 'photo') {
      // data is a base64 data URL (client downscales to a small JPEG). Decode + store.
      const data = String(p.data || '');
      const m = data.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
      if (!m) return json(400, { ok: false, error: 'bad image' });
      const contentType = m[1];
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 6 * 1024 * 1024) return json(400, { ok: false, error: 'image too large' });
      const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
      const path = `${g.company_id}/${g.job_id}/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
      const ok = await db.storagePut('intake-photos', path, buf, contentType);
      if (!ok) return json(200, { ok: false, error: 'upload_failed' });
      const publicUrl = `${url}/storage/v1/object/public/intake-photos/${path}`;
      await db.insert('job_media', { company_id: g.company_id, job_id: g.job_id, kind: 'photo', provider: 'storage', ref: path, label: String(p.label || 'Model sticker').slice(0, 80) });
      await note(db, g, '📸 Sent a model-number photo');
      return json(200, { ok: true, url: publicUrl });
    }

    if (doo === 'waiver') {
      const name = String(p.name || '').trim().slice(0, 120);
      if (!name) return json(400, { ok: false, error: 'name required' });
      await db.patch(`job?id=eq.${g.job_id}`, { waiver_name: name, waiver_signed_at: new Date().toISOString() });
      await note(db, g, `✍️ Release of liability signed by ${name}`);
      // Wear-item upsell decision (appliance-aware). "yes" = a real add-on lead for the
      // shop; "no" = the documented decline that shields the shop later. Either way it's
      // captured on the job thread so the office sees it.
      const hose = String(p.hose || '').trim();
      const hoseLabel = String(p.hose_label || 'the wear item').trim().slice(0, 60);
      if (hose === 'yes') await note(db, g, `🔧 UPSELL: wants ${hoseLabel} installed — tech to quote on site`);
      else if (hose === 'no') await note(db, g, `🛡️ Offered ${hoseLabel} — customer declined (documented ${new Date().toLocaleDateString('en-US')})`);
      // Floor protection choice
      const floor = String(p.floor || '').trim();
      if (floor === 'protect') await note(db, g, '🛟 FLOORS: interested in floor protection — quote / follow up');
      else if (floor === 'careful') await note(db, g, '🛟 FLOORS: wants the tech to take extra care with flooring');
      else if (floor === 'fine') await note(db, g, '🛟 FLOORS: no concern');
      return json(200, { ok: true });
    }

    if (doo === 'finish') {
      // Dedup the shop ping: only fire the cockpit text on the FIRST finish (a customer
      // re-tapping "All done" must not re-text the shop).
      let already = false;
      try { const pre = await db.get(`job?id=eq.${g.job_id}&select=intake_done_at&limit=1`); already = !!(pre && pre[0] && pre[0].intake_done_at); } catch (_) {}
      await db.patch(`job?id=eq.${g.job_id}`, { intake_done_at: new Date().toISOString() });
      await note(db, g, '✅ Finished intake — ready to schedule');
      if (!already) { try { await notifyShopIntakeDone(db, url, g); } catch (_) {} }
      return json(200, { ok: true });
    }

    return json(200, { ok: false, error: 'unknown do' });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
