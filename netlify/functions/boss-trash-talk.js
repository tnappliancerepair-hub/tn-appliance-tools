// boss-trash-talk — 😂 random taunts + laughing from THE BOSS (Teddy) to the field
// crew through the workday, to keep "Beat the Boss" loud and fun. Pulls the live
// leaderboard so the boss can gloat with real numbers ("still 75% and #1 😂").
//
// Scheduled a few times a day (UTC in netlify.toml); each run only *maybe* fires
// (random) during CT tech hours on weekdays — so it lands unpredictably, not on a
// clock. Kill switch: env BOSS_TRASH_ENABLED='false'. ?force=1 sends now, ?dryrun=1
// previews without sending.
'use strict';

const { sendSms } = require('./_lib/sms');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';

// Field crew (active). Owner/Teddy is the SENDER, not a recipient.
const CREW = [
  { name: 'Jimmy', phone: '+16159671304' },
  { name: 'Andre', phone: '+15049099413' },
  { name: 'Lee', phone: '+16158291654' },
  { name: 'John', phone: '+18133527686' },
];

const CHANCE = 0.55;              // probability a scheduled run actually fires
const MIN_GAP_MS = 2.5 * 3600000; // don't taunt more than once per ~2.5h

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
function ctParts() {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', hour12: false });
  const o = {}; f.formatToParts(new Date()).forEach((p) => { o[p.type] = p.value; });
  return { hour: parseInt(o.hour, 10), wd: o.weekday };
}
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function asObj(m) { if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return {}; } } return m || {}; }

// General boss trash (always eligible)
const GENERAL = [
  "Y'all locked in your guesses yet? Or scared? 😂👑",
  "Just checked the board. Still me at the top. Shocker. 🤣",
  "Somebody take this crown off me — PLEASE. I'm bored up here. 😂",
  "Every job's a title shot, boys. And every job I'm still champ. 🥊👑",
  "I diagnose 'em before the truck even starts. Y'all still reading the sticker? 🤣",
  "Talk is cheap. Lock it in. Watch me be right anyway. 😎",
  "Beat the boss? Cute. Keep dreaming. 😂",
  "I'll make it fair — I'll guess with my eyes closed. Still gonna smoke you. 🤣👑",
];
function lines(sb) {
  const champ = sb && sb.champion;
  const out = GENERAL.slice();
  if (champ && champ.is_boss) {
    out.push(
      `Reigning champ checking in: ${champ.rate}% first-guess. 😂 Anybody? Anybody?? 👑`,
      `Still ${champ.correct}/${champ.plays} and still wearing the crown. Come take it. 🥊😆`,
      "The boss reveals himself daily — at the TOP of the leaderboard. 🤣👑",
    );
  } else if (champ && !champ.is_boss) {
    out.push(
      `${champ.name} thinks that crown is his. 😂 Enjoy the rental, I'm taking it back today.`,
      `Careful ${champ.name} — heavy is the head. I'm coming for it. 👑🥊`,
      `So ${champ.name}'s on the throne, huh? Cute little reign. 🤣`,
    );
  } else {
    out.push("No champ yet? That's because nobody can catch me. Lock in your guesses, cowards. 😂👑");
  }
  return out;
}

async function recentlySent() {
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=boss_trash_sent&days_back=1&limit=10`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json();
    const rows = (d && (d.items || d.rows)) || [];
    let latest = 0;
    for (const row of rows) { const at = Number(row.created_at) || Number(asObj(row.metadata).at_ms) || 0; if (at > latest) latest = at; }
    return latest && (Date.now() - latest < MIN_GAP_MS);
  } catch (_) { return false; }
}
async function logSent(msg) {
  try { await fetch(`${XANO}/record_event_log`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'boss_trash_sent', metadata_json: JSON.stringify({ msg, at_ms: Date.now() }) }) }); } catch (_) {}
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const force = q.force === '1' || q.force === 'true';
  const dry = q.dryrun === '1' || q.dryrun === 'true';

  if (String(process.env.BOSS_TRASH_ENABLED || '').toLowerCase() === 'false' && !force) return j(200, { ok: true, skipped: 'disabled' });

  if (!force) {
    const { hour, wd } = ctParts();
    const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(wd);
    if (!weekday) return j(200, { ok: true, skipped: 'weekend' });
    if (hour < 9 || hour >= 18) return j(200, { ok: true, skipped: 'off_hours', hour });
    if (Math.random() > CHANCE) return j(200, { ok: true, skipped: 'random_pass' });
    if (await recentlySent()) return j(200, { ok: true, skipped: 'too_soon' });
  }

  // live standings (not the demo range) so the gloat is real
  let sb = {};
  try { sb = await fetch(`${SITE}/.netlify/functions/game-grade?scoreboard=1`, { signal: AbortSignal.timeout(9000) }).then((r) => r.json()); } catch (_) {}
  const msg = pick(lines(sb)) + '  — Teddy';

  if (dry) return j(200, { ok: true, dryrun: true, would_send: msg, champion: sb.champion || null });

  const results = [];
  for (const t of CREW) {
    let sent = false;
    try { sent = !!(await sendSms(t.phone, msg, 'technician', 'boss_trash_talk')); } catch (_) {}
    results.push({ who: t.name, sent });
  }
  await logSent(msg);
  return j(200, { ok: true, sent_to: results, msg });
};
