// hook-doctor — punches a raw clip up to the 3-beat formula that makes people
// stop scrolling: a 1-second HOOK (a promise), a human MIDDLE (point the camera
// at the person, not the task), and a satisfying PAYOFF (the fix roars back /
// the one-liner / the sign-off). Written in TN Appliance's real, folksy, self-
// deprecating "good ol days" voice — only TRUE claims, never clickbait-lie.
//   POST { secret, title, transcript?, appliance?, character?, is_long? }
//     -> { ok, hooks:[3], middle, payoff, notes }
'use strict';
const { getSecret } = require('./_lib/secrets');
const { runBrainTurn } = require('./_lib/ant/brain-core');

function parseJson(raw) {
  const cleaned = String(raw || '').replace(/```json/g, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(cleaned.slice(s, e + 1)); } catch (_) {} }
  return null;
}
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

const SYS = `You are the "Hook Doctor" for TN Appliance Exchange LLC — a REAL family-owned appliance shop (since 2012, Middle Tennessee & South Louisiana). You punch raw clips up so people STOP SCROLLING and can't explain why they're watching an appliance video.

THE ONE TRUTH: nobody watches the appliance — they watch the PERSON. The repair is just the room the personality lives in (same reason kids watch one streamer for hours, not "video games"). So the hook sells the human moment or the tiny mystery, never the task.

THE 3-BEAT FORMULA every clip follows:
1. HOOK (second 1 = a promise): make a thumb stop. Two flavors — the PROBLEM ("this dryer ain't heated in a week — watch") or the PAYOFF-TEASE ("watch what a six-dollar part does"). Short, spoken out loud, real. A curiosity gap or a stakes line. NEVER a lie or a fake promise.
2. MIDDLE (point the camera at the person, not the task): a one-line reminder of the HUMAN beat to center — the customer's reaction, the character in the shop, the dry aside, the confident hands. The fix happens in the background of a human moment.
3. PAYOFF (the last second): the satisfying reveal (machine roars back on / clean before-after), or the one-liner, plus a signature sign-off so people know it's US.

VOICE: genuine, folksy, dry, self-deprecating hillbilly, proud of the "good ol days." Never corporate, never hype-yelling ("SMASH LIKE"), never clickbait. Confident, warm, funny, real. Only claims that are TRUE. If a character name is given (like Paw), lean into that character.

Return STRICT JSON only, no prose, this exact shape:
{
  "hooks": ["<3 hook first-lines, each <=12 words, spoken-out-loud, scroll-stopping>"],
  "middle": "<1 sentence: the human moment to point the camera at>",
  "payoff": "<1 sentence: the closing beat / reveal / sign-off line>",
  "notes": ["<2-3 short production nudges: what to mic, when to hold a beat of silence, what to show on screen>"]
}`;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { error: 'unauthorized' });
  const title = String(b.title || '').trim();
  if (!title) return json(400, { error: 'title required' });

  const user = [
    'Clip topic / title: ' + title,
    b.appliance ? 'Appliance: ' + b.appliance : '',
    b.character ? 'Character/person in the clip: ' + b.character : '',
    b.is_long ? 'Format: long-form video' : 'Format: short vertical clip (Reel/Short/TikTok)',
    b.transcript ? ('Transcript/notes:\n' + String(b.transcript).slice(0, 4000)) : '',
    '\nWrite the hook package as strict JSON.',
  ].filter(Boolean).join('\n');

  const r = await runBrainTurn({ systemPrompt: SYS, userContent: user, ctx: { brain: 'hook_doctor' }, maxTokens: 1400 });
  if (r.error) return json(502, { error: 'brain_failed', detail: r.error });
  const parsed = parseJson(r.reply);
  if (!parsed || !parsed.hooks) return json(502, { error: 'parse_failed', raw: (r.reply || '').slice(0, 500) });
  return json(200, {
    ok: true,
    hooks: parsed.hooks,
    middle: parsed.middle || '',
    payoff: parsed.payoff || '',
    notes: parsed.notes || [],
  });
};
