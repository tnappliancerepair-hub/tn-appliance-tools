// meistertask-flaws — mines the comment history for the recurring PROBLEM patterns
// (the stuff that cost time/money/customers) so we can target fixes:
//   • parts back-orders / long ETAs            • callbacks / recalls / "still not working"
//   • second trips / wrong-part reorders       • lost repairs (buyout / cash-in-lieu / denied)
//   • warranty + customer chase overhead       • authorization / over-limit friction
// Counts cards hit per flaw + keeps a few example snippets. Dedupes by card_id.
//   GET ?secret=<admin>[&ex=3]   (ex = examples kept per flaw)
'use strict';

const { getSecret } = require('./_lib/secrets');
const sb = require('./_lib/supabase');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TABLE = 'meistertask_archive';
const PAGE = 500;

const FLAWS = [
  ['Parts back-order / long ETA', /back ?order|\bb\/o\b|on back ?order|eta \d+\s*-\s*\d+\s*(wk|week)|still (waiting|on) .*(part)|part(s)? (not (available|in)|on order)|not available until/i],
  ['Callback / recall / not fixed', /still not working|came back|call ?back|\brecall\b|30-?day recall|didn'?t fix|not fixed|same (issue|problem)|did not (resolve|fix)|returned (the )?(call|trip)/i],
  ['Second trip / wrong part / reorder', /order another|wrong part|re-?order|reorder|second (trip|visit)|return trip|misdiagnos|need(ed)? to order|ordered the wrong/i],
  ['Lost repair (buyout / cash-in-lieu / denied)', /cash ?out|buyout|buy ?out|\bcil\b|cash in lieu|\bdenied\b|not worth (fixing|repair)|replace(d|ment) (approved|the unit)|unit replace/i],
  ['Chase overhead (warranty/customer follow-up)', /warranty called|h\/o called|called (again|for (an )?update)|reach(ed)? out to autho|customer (is )?waiting|hasn'?t (gotten|heard) back|chasing|no response|left (a )?message with/i],
  ['Authorization / over-limit friction', /autho(rization)?|over (the )?(autho|limit)|check (&|and) advise|exceed(ed|s)?|pre-?auth|verbal auth|need(s)? approval/i],
  ['Customer no-show / scheduling churn', /no[- ]?show|reschedul|missed (the )?appoint|not home|couldn'?t reach|won'?t answer|cancel(led|ed)/i],
];

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let admin = ''; try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (q.secret !== admin) return { statusCode: 401, body: 'unauthorized' };
  if (!(await sb.isConnected())) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'supabase_not_configured' }) };
  const exKeep = Math.min(6, Math.max(0, Number(q.ex) || 3));

  const seen = new Set();
  const hit = {}, ex = {};
  for (const [name] of FLAWS) { hit[name] = 0; ex[name] = []; }
  let cards = 0, comments = 0, offset = 0;
  for (;;) {
    let rows;
    try { rows = await sb.select(TABLE, { board: 'eq._comment', select: 'card,card_id', order: 'id.asc', limit: String(PAGE), offset: String(offset) }); }
    catch (e) { return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) }; }
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) {
      const card = r.card || {};
      const cid = String(card.card_id || r.card_id || '');
      if (cid && seen.has(cid)) continue; if (cid) seen.add(cid);
      const list = Array.isArray(card.comments) ? card.comments : [];
      if (!list.length) continue;
      cards++;
      const joined = list.map((c) => String((c && (c.text || c.body || c.content)) || '')).join('\n');
      comments += list.length;
      for (const [name, re] of FLAWS) {
        const m = joined.match(re);
        if (m) {
          hit[name]++;
          if (ex[name].length < exKeep) {
            const i = Math.max(0, joined.search(re) - 30);
            ex[name].push(joined.slice(i, i + 160).replace(/\s+/g, ' ').trim());
          }
        }
      }
    }
    offset += rows.length;
    if (rows.length < PAGE) break;
  }
  const flaws = FLAWS.map(([name]) => ({ flaw: name, cards_hit: hit[name], pct_of_comment_cards: cards ? Math.round((hit[name] / cards) * 1000) / 10 : 0, examples: ex[name] }))
    .sort((a, b) => b.cards_hit - a.cards_hit);
  const out = { ok: true, comment_cards_scanned: cards, comments_scanned: comments, flaws };
  try { await sb.insert(TABLE, { board: '_flaws', card_id: 'ALL', title: 'flaws_view', notes: '', card: out }); } catch (_) {}
  return { statusCode: 200, body: JSON.stringify(out, null, 2) };
};
