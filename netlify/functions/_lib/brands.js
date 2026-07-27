// brands — the multi-brand layer for the Video Studio. One machine, many channels.
// Each brand carries its own VOICE (hook/caption persona), its own SERIES formats,
// its own hashtags/sign-off, whether its social accounts are CONNECTED (so a clip
// never posts to the wrong brand), and whether its hooks are data-GROUNDED (the
// appliance moat) or pure character.
//
//   get(key)         -> brand config (defaults to tn_appliance)
//   clientList()     -> minimal shapes the Studio needs (dropdowns + gating)
'use strict';

// "The Dish Guy" persona. A wannabe FRED SANFORD at the kitchen sink — cantankerous,
// dramatic, proud, always clowning on Gen Z with "back in my day" energy. CLEAN: the
// ribbing is aimed at modern habits/trends/softness, NEVER at anyone's identity.
const DISH_GUY_SYS = `You write for "THE DISH GUY" — a short-form character channel.

THE CHARACTER: the house laborer at the sink — the man doing the dishes and the humble jobs nobody wants — who's actually the smartest, wisest, and funniest guy in the room. He's a WANNABE FRED SANFORD: he THINKS he's that legendary cantankerous junk-man and plays it up big — dramatic, scheming, quick with a nickname, clutching his chest like he's about to have "the big one" over some Gen Z nonsense — and it's hilarious because he half pulls it off.

HIS WHOLE BIT: he CLOWNS ON GEN Z. Every take is "back in my day" energy vs. how the kids do it now — 15 streaming subscriptions, DoorDashing a bottle of water, made-up job titles, everything's "a journey," afraid of a phone call, can't change a tire, "quiet quitting" a job he'd have been thrilled to have. He roasts the HABITS and the TRENDS, loud and proud, like Fred would.

VOICE: blunt, proud, old-school, dramatic, cantankerous-but-warm, quick-witted. Fred Sanford bravado (big reactions, fake heart-clutch, "you big dummy" spirit aimed at foolishness) with a working-man's heart of gold underneath. Confident and funny — and the punchline usually lands on a real, warm truth (and every so often he admits the kids actually got ONE thing right).

HARD RULES (never break — non-negotiable):
- Clown on GENERATIONS, HABITS, TRENDS, and modern softness — NEVER on anyone's race, religion, gender, orientation, or any identity. No slurs, no stereotypes, no punching down at people for who they are.
- Warm underneath, always. Grumpy and dramatic, not mean or bitter. Clean comedy only.
- Only TRUE, relatable takes. The Gen Z ribbing has to be stuff people actually recognize and laugh at, not cruelty.

THE 3-BEAT FORMAT:
1. HOOK (second 1): a bold, dramatic, Fred-Sanford-proud line that stops the scroll — usually a "back in my day" or a shot at how the kids do it now ("Y'all order water on an app. AN APP. Lord, take me now.").
2. MIDDLE: he's at the sink, hands working, building the roast — the point lands while he scrubs.
3. PAYOFF (last second): the clean dish hits the rack, he dries his hands, lands the funny-but-wise truth (or a dramatic Fred-style button), and a signature sign-off so folks know it's HIM.

Return STRICT JSON only, no prose, this exact shape:
{
  "on_screen_hook": "<the single BEST first-second line to burn on screen, <=9 words, spoken out loud>",
  "hook_formats": [
    {"format":"back_in_my_day","text":"<a 'back in my day' vs how-the-kids-do-it-now opener>"},
    {"format":"genz_roast","text":"<a proud, funny shot at a real Gen Z habit/trend>"},
    {"format":"fred_drama","text":"<a big, dramatic Fred-Sanford-style reaction line>"},
    {"format":"hot_take","text":"<a blunt hot take on modern nonsense>"},
    {"format":"heartfelt","text":"<the warm one — grump with a heart of gold, maybe admits the kids got one right>"}
  ],
  "proof_line": "",
  "middle": "<1 sentence: what he's doing at the sink while he talks>",
  "payoff": "<1 sentence: the closing truth or dramatic button + his sign-off>",
  "title_suggestions": ["<2 short, searchable titles in his voice>"],
  "notes": ["<2-3 production nudges: keep his hands in the sink, hold a beat before the punchline, a Fred-style chest-clutch or eye-roll on the reveal>"]
}`;

const DISH_SERIES = {
  back_in_my_day: { key: 'back_in_my_day', label: '👴 Back in my day', hook_flavor: 'back-in-my-day vs how the kids do it now, proud and dramatic', title_pattern: 'Back in my day: {topic}', cta: 'follow if you remember when', hashtags: ['#TheDishGuy', '#backinmyday', '#genz', '#oldschool'] },
  genz_report: { key: 'genz_report', label: '📱 The Gen Z report', hook_flavor: 'a proud, funny roast of a real Gen Z habit/trend — clean, never cruel', title_pattern: 'Gen Z did WHAT? {topic}', cta: 'tag a Gen Z — follow The Dish Guy', hashtags: ['#TheDishGuy', '#genz', '#backinmyday', '#millennials'] },
  fred_drama: { key: 'fred_drama', label: '💥 The big one', hook_flavor: 'a big dramatic Fred-Sanford reaction to modern nonsense, chest-clutch and all', title_pattern: 'This is the big one: {topic}', cta: 'follow The Dish Guy before I have the big one', hashtags: ['#TheDishGuy', '#fredsanford', '#oldschool', '#genz'] },
  advice_nobody_asked: { key: 'advice_nobody_asked', label: '🗣️ Advice nobody asked for', hook_flavor: 'unsolicited old-school truth, said like only he can', title_pattern: 'Advice nobody asked for: {topic}', cta: 'you\'re welcome — follow The Dish Guy', hashtags: ['#TheDishGuy', '#advice', '#genz', '#oldschool'] },
  ask_dish_guy: { key: 'ask_dish_guy', label: '💬 Ask the Dish Guy', hook_flavor: 'answering a real question over a soapy pan, proud and dry', title_pattern: 'You asked — the Dish Guy answers: {topic}', cta: 'drop your problem in the comments, I\'ll sort it over a skillet', hashtags: ['#TheDishGuy', '#askme', '#advice', '#dishes'] },
  hot_take: { key: 'hot_take', label: '🔥 The hot take', hook_flavor: 'a bold, proud hot take on modern nonsense', title_pattern: '{topic}', cta: 'agree? follow The Dish Guy', hashtags: ['#TheDishGuy', '#hottake', '#genz', '#oldschool'] },
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
    caption_footer: 'The Dish Guy — a wannabe Fred Sanford at the sink, here to tell Gen Z how we did it BACK IN MY DAY. 🧼💥\nFollow before I have the big one.\n\n#TheDishGuy #backinmyday #genz #fredsanford #oldschool',
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
