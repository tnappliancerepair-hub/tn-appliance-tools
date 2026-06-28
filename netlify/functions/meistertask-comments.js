// meistertask-comments — control surface for the comment pull.
//   ?sample=15&secret=[&board=TN%20Jobs][&offset=0] -> fetch+RETURN comments for N cards (inspect; SYNC so we see the body)
//   ?secret=[&board=TN%20Jobs][&restart=1]          -> start/continue the resumable grind (background, self-chaining)
//   ?status=1&secret=                                -> read grind progress (the _comment_state cursor)
'use strict';

const { getSecret } = require('./_lib/secrets');
const mt = require('./_lib/meistertask');
const sb = require('./_lib/supabase');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TABLE = 'meistertask_archive';
const SITE = (process.env.URL || 'https://tnapplianceexchange.net').replace(/\/+$/, '');
const EXCLUDE = '(_manifest,_analysis,_comment,_comment_state)';

async function realCardsPage(board, offset, limit) {
  const params = { select: 'card_id,board', order: 'id.asc', offset: String(offset), limit: String(limit) };
  if (board) params.board = 'eq.' + board; else params.board = 'not.in.' + EXCLUDE;
  return sb.select(TABLE, params);
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let admin = ''; try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (q.secret !== admin) return { statusCode: 401, body: 'unauthorized' };

  if (q.status) {
    try {
      const rows = await sb.select(TABLE, { board: 'eq._comment_state', order: 'imported_at.desc', limit: '1' });
      return { statusCode: 200, body: JSON.stringify({ ok: true, state: (rows && rows[0] && rows[0].card) || null }, null, 2) };
    } catch (e) { return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) }; }
  }

  if (q.sample) {
    if (!(await mt.isConfigured())) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'meistertask_not_configured' }) };
    const n = Math.min(25, Math.max(1, Number(q.sample) || 15));
    let cards = [];
    try { cards = await realCardsPage(q.board || '', Number(q.offset || 0), n); } catch (e) { return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) }; }
    const out = []; let withComments = 0;
    for (const c of (cards || [])) {
      let comments = [];
      try { comments = await mt.listTaskComments(c.card_id); } catch (e) { comments = [{ _error: String((e && e.message) || e) }]; }
      if (Array.isArray(comments) && comments.length && !comments[0]._error) withComments++;
      // trim each comment to the text we care about to keep the payload readable
      const slim = (Array.isArray(comments) ? comments : []).map((x) => ({
        text: (x && (x.text || x.body || x.content || '')).toString().slice(0, 600),
        by: x && (x.creator_name || x.author_name || x.user_name || ''),
        at: x && (x.created_at || ''),
      }));
      out.push({ card_id: c.card_id, board: c.board, n: Array.isArray(comments) ? comments.length : 0, comments: slim });
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, sampled: out.length, with_comments: withComments, results: out }, null, 2) };
  }

  // fire the grind (background, self-chaining)
  const url = `${SITE}/.netlify/functions/meistertask-comments-background?secret=${encodeURIComponent(admin)}${q.board ? '&board=' + encodeURIComponent(q.board) : ''}${q.restart ? '&restart=1' : ''}`;
  await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => {});
  return { statusCode: 200, body: JSON.stringify({ ok: true, triggered: true, board: q.board || 'ALL' }) };
};
