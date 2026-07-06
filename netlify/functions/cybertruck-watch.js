// cybertruck-watch — personal utility for Teddy. Watches the connected Gmail for
// Tesla inventory / availability / order emails about the CYBERTRUCK and TEXTS
// Teddy the moment one lands, so he doesn't babysit his inbox waiting on a truck.
//
// WHY a Gmail relay instead of hitting Tesla's inventory API directly: Tesla's
// inventory endpoint hard-blocks automated/server access (Akamai 403 to any
// datacenter IP — proven 2026-07-06). A scraper/API-poller would keep getting
// blocked. Tesla itself, though, emails you when matching inventory appears — so
// we let Tesla do the searching and just relay its email to SMS. Reliable,
// unblockable, reuses the pollers' Gmail OAuth + the owner-SMS path.
//
// Teddy's one setup step: turn on Tesla inventory notifications for Cybertruck in
// his Tesla account (or a saved search), and make sure those emails go to — or are
// forwarded to — one of the connected inboxes (searchAll scans all of them).
//
// Dedups on alerted message IDs (event_log) so it texts once per email.
// ?dryrun=1 returns matches without texting. Kill switch: env CYBERTRUCK_WATCH=false.
'use strict';

const { sendSms } = require('./_lib/sms');
const { searchAll } = require('./_lib/gmail-accounts');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG = 3;
const OWNER = '+16154855795';

// Tesla mail specifically about a Cybertruck (inventory match / availability /
// order / delivery / price). Requiring "cybertruck" keeps Model 3/Y marketing out;
// the action words keep generic newsletters out. Dedup handles any repeats.
const QUERY = 'newer_than:12d from:tesla.com (cybertruck OR "cyber truck") '
  + '(inventory OR available OR "now available" OR "in stock" OR order OR "ready to order" '
  + 'OR "available to order" OR match OR matching OR delivery OR reserve OR price OR "new match")';

function hdr() { const t = process.env.XANO_METADATA_TOKEN; return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null; }

async function seenIds() {
  const h = hdr(); if (!h) return new Set();
  try {
    const r = await fetch(`${META}/table/${EVENT_LOG}/content/search`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ search: { action: 'cybertruck_watch_seen' }, sort: { id: 'desc' }, per_page: 1, page: 1 }),
    });
    const j = await r.json().catch(() => ({}));
    let m = ((j.items || [])[0] || {}).metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    return new Set((m && m.ids) || []);
  } catch (_) { return new Set(); }
}
async function recordSeen(ids) {
  const h = hdr(); if (!h) return;
  try { await fetch(`${META}/table/${EVENT_LOG}/content`, { method: 'POST', headers: h, body: JSON.stringify({ action: 'cybertruck_watch_seen', metadata: { ids: [...ids].slice(-60), at_ms: Date.now() } }) }); } catch (_) {}
}

exports.handler = async function (event) {
  const dry = (event.queryStringParameters || {}).dryrun === '1';
  if (String(process.env.CYBERTRUCK_WATCH || '').toLowerCase() === 'false') return { statusCode: 200, body: 'disabled' };

  let matches = [];
  try {
    const res = await searchAll(QUERY, { max: 12 });
    if (!res.accounts.length) return { statusCode: 200, body: 'no connected gmail accounts' };
    matches = res.matches;
  } catch (e) {
    return { statusCode: 200, body: 'gmail read failed: ' + String((e && e.message) || e) };
  }

  if (dry) return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, count: matches.length, matches }, null, 2) };
  if (!matches.length) return { statusCode: 200, body: 'no tesla cybertruck mail' };

  const seen = await seenIds();
  const fresh = matches.filter((m) => !seen.has(m.id));
  if (!fresh.length) return { statusCode: 200, body: 'already alerted' };

  const top = fresh[0];
  const extra = fresh.length > 1 ? `\n(+${fresh.length - 1} more Tesla email${fresh.length - 1 === 1 ? '' : 's'})` : '';
  const body = `🛻 Tesla Cybertruck alert — an email just landed:\n\n"${(top.subject || '(no subject)').slice(0, 100)}"\n${(top.snippet || '').slice(0, 120)}\n\nIn ${top.account || 'your inbox'}. Open the Tesla email to see the truck + price — they ship it to you.${extra}`;
  try { await sendSms(OWNER, body, 'owner', 'cybertruck_watch'); } catch (_) {}
  fresh.forEach((m) => seen.add(m.id));
  await recordSeen(seen);
  return { statusCode: 200, body: `alerted: ${fresh.length} new (subject: ${top.subject})` };
};
