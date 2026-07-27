// brands — the multi-brand layer for the Video Studio. One machine, many channels.
// Each brand carries its own VOICE (hook/caption persona), its own SERIES formats,
// its own hashtags/sign-off, whether its social accounts are CONNECTED (so a clip
// never posts to the wrong brand), and whether its hooks are data-GROUNDED (the
// appliance moat) or pure character.
//
//   get(key)         -> brand config (defaults to tn_appliance)
//   clientList()     -> minimal shapes the Studio needs (dropdowns + gating)
'use strict';

// "The Dish Guy" persona. Blunt, proud, old-school, unfiltered — a little Archie
// Bunker, a little George Jefferson — but CLEAN. The comedy is confidence + honesty,
// aimed at nonsense/laziness/fakeness, NEVER at people's identity.
const DISH_GUY_SYS = `You write for "THE DISH GUY" — a short-form character channel.

THE CHARACTER: the house laborer. The man at the sink doing the dishes and the humble jobs nobody else wants — who turns out to be the SMARTEST, wisest person in the room. He schools the whole house while he scrubs a pan.

VOICE: blunt, proud, old-school, unfiltered, cantankerous-but-warm, quick-witted. A little ARCHIE BUNKER (says what everyone's thinking, tells it straight, a working-man grump with a heart of gold) and a little GEORGE JEFFERSON (brash, proud, struts, sharp tongue, no patience for nonsense). Confident and funny — and every take LANDS on a genuinely wise or warm truth. He's the smartest guy in the room, so he's RIGHT: the punchline is real insight, not just an insult.

HARD RULES (never break — this is non-negotiable):
- NEVER bigoted, prejudiced, or punching down. No slurs, no stereotypes, no mocking anyone's race, religion, gender, or the like. The blustery "tells-it-like-it-is" energy is aimed ONLY at nonsense, laziness, fakeness, and modern silliness — never at people's identity.
- Warm underneath, always. Grumpy, not mean. Clean comedy only.
- Only TRUE, human, relatable takes. Wisdom + humor. Never cruel.

THE 3-BEAT FORMAT:
1. HOOK (second 1): a bold, funny, proud line that stops the scroll — the laborer about to school you ("You want life advice? From the man doing your dishes? Sit down.").
2. MIDDLE: he's at the sink, hands working, dropping the take — the point lands while he scrubs.
3. PAYOFF (last second): the clean dish goes in the rack, he dries his hands, lands the wise/funny truth, and a signature sign-off so folks know it's HIM.

Return STRICT JSON only, no prose, this exact shape:
{
  "on_screen_hook": "<the single BEST first-second line to burn on screen, <=9 words, spoken out loud>",
  "hook_formats": [
    {"format":"bold_open","text":"<a proud, scroll-stopping opener>"},
    {"format":"hot_take","text":"<a blunt hot take on everyday nonsense>"},
    {"format":"old_school","text":"<a 'back in my day' angle>"},
    {"format":"punchline","text":"<a funny setup that pays off wise>"},
    {"format":"heartfelt","text":"<the warm one — grump with a heart of gold>"}
  ],
  "proof_line": "",
  "middle": "<1 sentence: what he's doing at the sink while he talks>",
  "payoff": "<1 sentence: the closing truth + his sign-off>",
  "title_suggestions": ["<2 short, searchable titles in his voice>"],
  "notes": ["<2-3 production nudges: keep his hands in the sink, hold a beat before the punchline, end on the dish in the rack>"]
}`;

const DISH_SERIES = {
  wisdom_sink: { key: 'wisdom_sink', label: '🧼 Wisdom over the sink', hook_flavor: 'one hard-earned nugget, delivered proud', title_pattern: '{topic}', cta: 'follow for the wisdom you didn\'t ask for', hashtags: ['#TheDishGuy', '#wisdom', '#dishes', '#oldschool'] },
  advice_nobody_asked: { key: 'advice_nobody_asked', label: '🗣️ Advice nobody asked for', hook_flavor: 'unsolicited truth, said like only he can', title_pattern: 'Advice nobody asked for: {topic}', cta: 'you\'re welcome — follow The Dish Guy', hashtags: ['#TheDishGuy', '#advice', '#reallife', '#oldschool'] },
  back_in_my_day: { key: 'back_in_my_day', label: '👴 Back in my day', hook_flavor: 'reacting to modern nonsense, proud and dry', title_pattern: 'Back in my day: {topic}', cta: 'follow if you remember when', hashtags: ['#TheDishGuy', '#backinmyday', '#oldschool', '#relatable'] },
  ask_dish_guy: { key: 'ask_dish_guy', label: '💬 Ask the Dish Guy', hook_flavor: 'answering a real question over a soapy pan', title_pattern: 'You asked — the Dish Guy answers: {topic}', cta: 'drop your problem in the comments, I\'ll sort it over a skillet', hashtags: ['#TheDishGuy', '#askme', '#advice', '#dishes'] },
  hot_take: { key: 'hot_take', label: '🔥 The hot take', hook_flavor: 'a bold, proud hot take on something everyday', title_pattern: '{topic}', cta: 'agree? follow The Dish Guy', hashtags: ['#TheDishGuy', '#hottake', '#reallife', '#oldschool'] },
};

const BRANDS = {
  tn_appliance: {
    key: 'tn_appliance',
    label: 'TN Appliance',
    display: 'TN Appliance Exchange LLC',
    personaSystem: null,        // null = use the built-in appliance Hook Doctor voice
    seriesSource: 'appliance',  // uses _lib/content-series SERIES
    grounded: true,             // real repair data (the moat)
    connected: true,            // its FB/IG/TikTok/YouTube are wired -> auto-post OK
    caption_footer: null,       // Studio's existing appliance captions
  },
  dish_guy: {
    key: 'dish_guy',
    label: 'The Dish Guy',
    display: 'The Dish Guy',
    personaSystem: DISH_GUY_SYS,
    series: DISH_SERIES,
    grounded: false,            // character/comedy, not data
    connected: false,           // accounts not connected yet -> download + post manually
    caption_footer: 'The Dish Guy — smartest man in the room\'s got his hands in the sink. 🧼\nFollow for the wisdom you didn\'t ask for.\n\n#TheDishGuy #wisdom #oldschool #dishes',
  },
};

function get(key) { return BRANDS[String(key || '').toLowerCase()] || BRANDS.tn_appliance; }
function seriesFor(brandKey, seriesKey) {
  const b = get(brandKey);
  if (b.series) return b.series[String(seriesKey || '').toLowerCase()] || Object.values(b.series)[0];
  return null; // appliance brand -> caller uses content-series
}
function clientList() {
  return Object.values(BRANDS).map((b) => ({
    key: b.key, label: b.label, connected: !!b.connected, grounded: !!b.grounded,
    caption_footer: b.caption_footer || null,
    series: b.series ? Object.values(b.series).map((s) => ({ key: s.key, label: s.label })) : null,
  }));
}

module.exports = { BRANDS, DISH_GUY_SYS, get, seriesFor, clientList };
