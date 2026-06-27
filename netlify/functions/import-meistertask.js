// import-meistertask — stores MeisterTask export cards into Supabase (the raw
// 7-year history archive, off Xano). The upload page reads the JSON export and
// posts cards here in batches; we store each card faithfully (whole object as
// jsonb) plus extract title/notes for easy querying. Embedding for pre-diagnosis
// is a later pass over this archive.
//
// One-time Supabase table (SQL editor):
//   create table if not exists meistertask_archive (
//     id bigint generated always as identity primary key,
//     board text, card_id text, title text, notes text,
//     card jsonb not null, imported_at timestamptz not null default now()
//   );
//   create index if not exists meistertask_archive_board on meistertask_archive (board);
//
// POST { secret, board, cards:[...] } -> { ok, inserted }
'use strict';

const { getSecret } = require('./_lib/secrets');
const sb = require('./_lib/supabase');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TABLE = 'meistertask_archive';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function pick(o, keys) {
  for (const k of keys) { if (o && o[k] != null && String(o[k]).trim()) return String(o[k]); }
  return '';
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  let admin = ''; try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (b.secret !== admin) return { statusCode: 401, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };

  if (!(await sb.isConnected())) return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'supabase_not_configured' }) };

  const board = String(b.board || 'meistertask').slice(0, 80);
  const cards = Array.isArray(b.cards) ? b.cards : [];
  if (!cards.length) return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'no cards in batch' }) };

  const rows = cards.map((c) => ({
    board,
    card_id: pick(c, ['id', 'token', 'uuid', 'card_id', 'taskId']),
    title: pick(c, ['name', 'title', 'subject']).slice(0, 500),
    notes: pick(c, ['notes', 'description', 'desc', 'body', 'text']).slice(0, 20000),
    card: c,
  }));

  try {
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      await sb.insert(TABLE, rows.slice(i, i + 200));
      inserted += Math.min(200, rows.length - i);
    }
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, inserted }) };
  } catch (e) {
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
