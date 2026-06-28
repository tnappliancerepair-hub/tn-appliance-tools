// meistertask-comments-background — pulls the COMMENT threads for archived cards
// (where the tech/office logged job outcomes: charged $, part cost, labor). One
// API call per card, so it's RESUMABLE + SELF-CHAINING: each run works a time-
// budgeted batch, saves a cursor, then re-invokes itself until done. Reuses the
// existing meistertask_archive table (no new DDL):
//   • comments stored as rows  board='_comment'        card={card_id, board, n, comments}
//   • progress stored as a row  board='_comment_state' card={offset, scope, done, ...}
//
//   GET ?secret=<admin>&sample=15[&board=TN%20Jobs]  -> fetch+RETURN comments for N cards (no store) to inspect
//   GET ?secret=<admin>[&board=TN%20Jobs][&restart=1] -> run/continue the resumable grind
'use strict';

const { getSecret } = require('./_lib/secrets');
const mt = require('./_lib/meistertask');
const sb = require('./_lib/supabase');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TABLE = 'meistertask_archive';
const SITE = (process.env.URL || 'https://tnapplianceexchange.net').replace(/\/+$/, '');
const EXCLUDE = '(_manifest,_analysis,_comment,_comment_state)';
const TIME_BUDGET_MS = 13 * 60 * 1000; // stop before Netlify's 15-min cap
const BATCH = 60; // rows fetched from Supabase per page while grinding

async function realCardsPage(board, offset, limit) {
  const params = { select: 'card_id,board', order: 'id.asc', offset: String(offset), limit: String(limit) };
  if (board) params.board = 'eq.' + board;
  else params.board = 'not.in.' + EXCLUDE;
  return sb.select(TABLE, params);
}

async function getState() {
  try {
    const rows = await sb.select(TABLE, { board: 'eq._comment_state', order: 'imported_at.desc', limit: '1' });
    return (rows && rows[0] && rows[0].card) || null;
  } catch (_) { return null; }
}
async function saveState(state) {
  // single state row: delete old, insert fresh
  try { await sb.del(TABLE, { board: 'eq._comment_state' }); } catch (_) {}
  try { await sb.insert(TABLE, { board: '_comment_state', card_id: state.scope || 'ALL', title: 'comment_cursor', notes: '', card: state }); } catch (_) {}
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let admin = ''; try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (q.secret !== admin) return { statusCode: 401, body: 'unauthorized' };
  if (!(await mt.isConfigured())) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'meistertask_not_configured' }) };
  if (!(await sb.isConnected())) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'supabase_not_configured' }) };

  const board = q.board || '';

  // ---- SAMPLE: fetch comments for the first N real cards and RETURN them ----
  if (q.sample) {
    const n = Math.min(40, Math.max(1, Number(q.sample) || 15));
    const cards = await realCardsPage(board, Number(q.offset || 0), n);
    const out = [];
    let withComments = 0;
    for (const c of (cards || [])) {
      let comments = [];
      try { comments = await mt.listTaskComments(c.card_id); } catch (e) { comments = [{ _error: String((e && e.message) || e) }]; }
      if (Array.isArray(comments) && comments.length && !comments[0]._error) withComments++;
      out.push({ card_id: c.card_id, board: c.board, n: Array.isArray(comments) ? comments.length : 0, comments });
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, sampled: out.length, with_comments: withComments, results: out }, null, 2) };
  }

  // ---- GRIND: resumable, self-chaining ----
  const t0 = Date.now();
  let state = (q.restart ? null : await getState()) || { scope: board || 'ALL', offset: 0, processed: 0, with_comments: 0, comments_total: 0, done: false, started_at: new Date().toISOString() };
  if (state.done && !q.restart) return { statusCode: 200, body: JSON.stringify({ ok: true, already_done: true, state }) };

  let stoppedForTime = false;
  for (;;) {
    if (Date.now() - t0 > TIME_BUDGET_MS) { stoppedForTime = true; break; }
    let page;
    try { page = await realCardsPage(state.scope === 'ALL' ? '' : state.scope, state.offset, BATCH); }
    catch (e) { state.last_error = String((e && e.message) || e); break; }
    if (!Array.isArray(page) || !page.length) { state.done = true; break; }

    const rows = [];
    for (const c of page) {
      if (Date.now() - t0 > TIME_BUDGET_MS) { stoppedForTime = true; break; }
      let comments = [];
      try { comments = await mt.listTaskComments(c.card_id); } catch (_) { comments = []; }
      const nc = Array.isArray(comments) ? comments.length : 0;
      state.processed++;
      state.offset++;
      if (nc) {
        state.with_comments++;
        state.comments_total += nc;
        rows.push({ board: '_comment', card_id: String(c.card_id), title: '', notes: '', card: { card_id: c.card_id, board: c.board, n: nc, comments } });
      }
    }
    if (rows.length) { try { await sb.insert(TABLE, rows); } catch (_) {} }
    if (stoppedForTime) break;
  }

  state.updated_at = new Date().toISOString();
  await saveState(state);

  // self-chain if there's more to do
  if (!state.done && (stoppedForTime || !state.last_error)) {
    const url = `${SITE}/.netlify/functions/meistertask-comments-background?secret=${encodeURIComponent(admin)}${board ? '&board=' + encodeURIComponent(board) : ''}`;
    fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => {});
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, state, chained: !state.done }) };
};
