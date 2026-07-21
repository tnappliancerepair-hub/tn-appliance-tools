// youtube-seo — writes search-optimized YouTube titles + description + tags for a
// clip or a full video. Appliance repair is SEARCH content ("dryer won't heat"),
// so this front-loads the keywords people actually type, adds a curiosity hook, and
// writes a keyword-rich description that ranks. Owner-gated.
//   POST { secret, title, transcript?, appliance?, brand?, is_long? }
//     -> { ok, titles:[3], description, tags:[], hashtags:[] }
'use strict';
const { getSecret } = require('./_lib/secrets');
const { runBrainTurn, tryParseJsonReply } = require('./_lib/ant/brain-core');

function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

const SYS = `You are the best YouTube SEO strategist for a REAL appliance-repair company, TN Appliance Exchange LLC (family-owned since 2012, Middle Tennessee & South Louisiana, phone 615-280-2949, tnapplianceexchange.net).

Appliance content is SEARCH content — people type exact problems ("dryer won't heat", "how to wire a dryer cord", "fridge not cooling"). Your job: maximize clicks AND search ranking, while keeping the brand's genuine, folksy, no-BS voice (never corporate, never clickbait-lie).

Return STRICT JSON only, no prose, this exact shape:
{
  "titles": ["<3 title options, <=90 chars each>"],
  "description": "<the YouTube description — see rules>",
  "tags": ["<8-15 search tags, lowercase>"],
  "hashtags": ["#3to5", "#relevant"]
}

TITLE rules: front-load the exact search phrase; add a curiosity or benefit hook; a number or "How to" when it fits; NO false promises. Pick the strongest as titles[0].
DESCRIPTION rules: first 2 lines are the hook + the main keyword (that's all that shows before "more"). Then 2-3 sentences of genuinely useful context using related search terms naturally. Then a clear CTA (call/text 615-280-2949, tnapplianceexchange.net, family-owned since 2012, serving Middle TN & South Louisiana). End with the hashtags line. Keep it real and human, not stuffed. IMPORTANT: keep the whole description under 800 characters so it stays tight.`;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { error: 'unauthorized' });
  const title = String(b.title || '').trim();
  if (!title) return json(400, { error: 'title required' });

  const user = [
    'Video/clip title or topic: ' + title,
    b.appliance ? 'Appliance: ' + b.appliance : '',
    b.brand ? 'Brand: ' + b.brand : '',
    b.is_long ? 'Format: long-form YouTube video' : 'Format: YouTube Short',
    b.transcript ? ('Transcript/notes:\n' + String(b.transcript).slice(0, 4000)) : '',
    '\nWrite the SEO package as strict JSON.',
  ].filter(Boolean).join('\n');

  const r = await runBrainTurn({ systemPrompt: SYS, userContent: user, ctx: { brain: 'youtube_seo' }, maxTokens: 2000 });
  if (r.error) return json(502, { error: 'brain_failed', detail: r.error });
  const parsed = tryParseJsonReply(r.reply);
  if (!parsed || !parsed.titles) return json(502, { error: 'parse_failed', raw: (r.reply || '').slice(0, 500) });
  return json(200, { ok: true, titles: parsed.titles, description: parsed.description, tags: parsed.tags || [], hashtags: parsed.hashtags || [] });
};
