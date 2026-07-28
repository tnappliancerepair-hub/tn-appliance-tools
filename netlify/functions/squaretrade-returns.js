// squaretrade-returns — the SquareTrade/Allstate parts-return SCOREBOARD.
//
// Fuses the authoritative weekly "ALLSTATE RMA REPORT" CSV (from
// APPtechcompliance@allstate.com — the real returned=0/1 truth, per part) with
// our own "✓ shipped it" taps (warranty_part_status), so Teddy sees, in real
// numbers: what's still OWED (money-at-risk), what's IN TRANSIT, what's RECEIVED
// (chargeback-safe), and any EXCEPTIONS — plus the true return rate.
//
//   GET ?secret=<admin>[&weeks=8][&raw=1]
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
function b64d(s) { try { return Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (_) { return ''; } }
const unquote = (v) => String(v == null ? '' : v).replace(/^="?/, '').replace(/"$/, '').replace(/"/g, '').trim();
const normPart = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

// tiny quote-aware CSV parser → array of row objects keyed by header
function parseCsv(text) {
  const s = String(text || '').replace(/\r/g, '');
  const rows = []; let field = '', row = [], inQ = false;
  const pushF = () => { row.push(field); field = ''; };
  const pushR = () => { pushF(); rows.push(row); row = []; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) { if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; continue; }
    if (c === '"') { inQ = true; continue; }
    if (c === ',') { pushF(); continue; }
    if (c === '\n') { pushR(); continue; }
    field += c;
  }
  if (field.length || row.length) pushR();
  if (rows.length < 2) return [];
  const hdr = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.length > 1).map((r) => { const o = {}; hdr.forEach((h, i) => { o[h] = (r[i] != null ? r[i] : '').trim(); }); return o; });
}

function mdyToMs(s) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || ''));
  if (!m) return 0;
  return Date.UTC(+m[3], +m[1] - 1, +m[2], 12, 0, 0);
}

async function gmail() {
  const id = process.env.GMAIL_CLIENT_ID, secret = process.env.GMAIL_CLIENT_SECRET, refresh = process.env.GMAIL_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  try { const { google } = require('googleapis'); const o = new google.auth.OAuth2(id, secret); o.setCredentials({ refresh_token: refresh }); return google.gmail({ version: 'v1', auth: o }); } catch (_) { return null; }
}

// Pull the last N weekly RMA-report CSVs and merge their rows. Dedupe per
// (claim, part): a RECEIVED (returned=1) row always wins; otherwise the newest.
async function loadReportRows(g, weeks) {
  const list = await g.users.messages.list({ userId: 'me', q: 'from:APPtechcompliance@allstate.com subject:(RMA REPORT) has:attachment newer_than:' + (weeks * 7 + 5) + 'd', maxResults: weeks + 4 });
  const msgs = (list.data.messages || []);
  const byKey = new Map();
  for (const mm of msgs) {
    let full; try { full = await g.users.messages.get({ userId: 'me', id: mm.id, format: 'full' }); } catch (_) { continue; }
    const reportMs = Number(full.data.internalDate) || 0;
    let attId = '';
    (function walk(p) { if (!p) return; if (p.filename && /\.csv$/i.test(p.filename) && p.body && p.body.attachmentId && !attId) attId = p.body.attachmentId; if (p.parts) p.parts.forEach(walk); })(full.data.payload);
    if (!attId) continue;
    let csv = ''; try { const a = await g.users.messages.attachments.get({ userId: 'me', messageId: mm.id, id: attId }); csv = b64d(a.data.data); } catch (_) { continue; }
    for (const row of parseCsv(csv)) {
      if (String(row.return_needed || '').trim() !== '1') continue; // only parts that must go back
      const claim = String(row.claim_id || '').replace(/[^0-9]/g, '');
      const part = String(row.part_number || '').trim();
      if (!claim || !part) continue;
      const key = claim + '::' + normPart(part);
      const rec = {
        claim, part,
        first: row['first name'] || '', last: row['last name'] || '',
        distributor: (row.depot || '').trim(),
        created_ms: mdyToMs(row.created),
        delivered_ms: mdyToMs(row.delivery_date),
        inbound_tracking: unquote(row.inbound_tracking),
        inbound_shipped_ms: mdyToMs(row.inbound_shipping_date),
        returned: String(row.returned || '').trim() === '1',
        exception: (row.exceptions && !/^n\/?a$/i.test(row.exceptions.trim())) ? row.exceptions.trim() : '',
        report_ms: reportMs,
      };
      const prev = byKey.get(key);
      if (!prev || rec.returned || (!prev.returned && rec.report_ms >= prev.report_ms)) byKey.set(key, rec);
    }
  }
  return byKey;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const weeks = Math.min(Math.max(parseInt(q.weeks, 10) || 8, 1), 16);

  const g = await gmail();
  if (!g) return json(200, { ok: false, error: 'gmail not connected' });

  let byKey, shippedTaps;
  try {
    [byKey, shippedTaps] = await Promise.all([
      loadReportRows(g, weeks),
      crud.searchPage(crud.TABLES.event_log, { action: 'warranty_part_status' }, { id: 'desc' }, 600).catch(() => []),
    ]);
  } catch (e) { return json(200, { ok: false, error: 'load failed: ' + String((e && e.message) || e) }); }

  // our "✓ shipped it" taps, keyed by claim::part (interim status until the report confirms received)
  const tapped = new Map();
  for (const r of shippedTaps) {
    const m = metaOf(r); const st = String(m.status || '').toLowerCase();
    if (st !== 'shipped' && st !== 'returned') continue;
    const claim = String(m.claim || '').replace(/[^0-9]/g, ''); const part = m.part || '';
    if (!claim || !part) continue;
    const key = claim + '::' + normPart(part);
    const at = Number(m.at_ms || r.created_at || 0);
    if (!tapped.has(key) || at > tapped.get(key)) tapped.set(key, at);
  }

  const now = Date.now();
  const items = [];
  for (const [key, r] of byKey) {
    const tapMs = tapped.get(key) || 0;
    let status, held_days = 0;
    if (r.returned) status = 'received';
    else if (r.inbound_shipped_ms || tapMs) status = 'in_transit';
    else status = 'owed';
    if (status === 'owed') { const anchor = r.delivered_ms || r.created_ms || 0; held_days = anchor ? Math.floor((now - anchor) / 86400000) : 0; }
    items.push({
      key, claim: r.claim, part: r.part, name: (r.first + ' ' + r.last).trim(),
      distributor: r.distributor, status, exception: r.exception,
      held_days, inbound_tracking: r.inbound_tracking,
      shipped_ms: r.inbound_shipped_ms || tapMs || 0, tapped: !!tapMs,
    });
  }

  // buckets + scoreboard
  const owed = items.filter((i) => i.status === 'owed');
  const transit = items.filter((i) => i.status === 'in_transit');
  const received = items.filter((i) => i.status === 'received');
  const exceptions = items.filter((i) => i.exception);
  const atRisk = owed.filter((i) => i.held_days >= 7).sort((a, b) => b.held_days - a.held_days);
  const total = items.length;
  const returnRate = total ? Math.round((received.length / total) * 100) : 0;

  owed.sort((a, b) => b.held_days - a.held_days);

  if (q.raw === '1') return json(200, { ok: true, weeks, count: total, items });
  return json(200, {
    ok: true, weeks,
    scoreboard: { total, owed: owed.length, in_transit: transit.length, received: received.length, exceptions: exceptions.length, at_risk: atRisk.length, return_rate: returnRate, goal: 80 },
    owed, at_risk: atRisk, in_transit: transit, exceptions,
  });
};
