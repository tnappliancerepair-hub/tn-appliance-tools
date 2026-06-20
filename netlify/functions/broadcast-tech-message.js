// broadcast-tech-message — owner/office sends ONE message to every active tech's
// in-app inbox (morning note, "slow day, grab extra jobs", etc.). Reuses the
// deployed send_office_to_tech_message per tech (writes the row, no SMS).
//
//   POST { office_password, body, sender_name? }  -> { ok, sent, techs }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TECH_TABLE = 15;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const pw = String(b.office_password || '');
  const body = String(b.body || '').trim();
  const senderName = String(b.sender_name || 'Office').slice(0, 40);
  if (!body) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'body required' }) };

  let techs = [];
  try { techs = await crud.searchPage(TECH_TABLE, {}, { id: 'asc' }, 50); } catch (_) {}
  // active field techs only; skip the owner (id 1) and any inactive/blank rows.
  const targets = (techs || []).filter((t) => t && t.id && t.id !== 1 && t.active !== false && t.first_name);

  let sent = 0; const names = [];
  for (const t of targets) {
    try {
      const r = await fetch(`${XANO}/send_office_to_tech_message`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tech_id: t.id, office_password: pw, body, sender_name: senderName }),
      });
      const d = await r.json().catch(() => ({}));
      if (d && d.success) { sent++; names.push(t.first_name); }
      else if (d && d.error === 'unauthorized') {
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };
      }
    } catch (_) {}
  }
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, sent, techs: names }) };
};
