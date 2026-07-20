# Marketing production stack — setup (2026-07-20)

Goal: automate content PRODUCTION (great videos/captions/voice) and feed it into the
already-automated DISTRIBUTION (post-everywhere → FB, IG, TikTok, X, Truth, YouTube).

**How each tool gets wired:** Teddy makes the account → grabs the API key → drops it in
the vault via **admin-secrets.html** (never in chat) → Claude flips the connector on +
verifies. Same staging pattern as TikTok/YouTube.

## The three tools — honest API status

| Tool | What it does | API for us? | Cost | Vault key |
|---|---|---|---|---|
| **ElevenLabs** | AI voiceover for faceless tip/review videos | ✅ **Self-serve** — well-documented | ~$5–22/mo | `ELEVENLABS_API_KEY` (+ optional `ELEVENLABS_VOICE_ID`) |
| **Submagic** | AI captions + auto b-roll + hooks on shorts | ✅ **Self-serve** — free key to test; full API on Business+API (~$41/mo) | ~$20–41/mo | `SUBMAGIC_API_KEY` |
| **Opus Clip** | 1 long video → 5–10 finished shorts | ⚠️ **Enterprise-only** API (contact sales, big annual commit) — NOT self-serve for a shop | ~$20–30/mo web app | — (see below) |

### ElevenLabs — get the key
elevenlabs.io → sign in (your own account; the Vapi one is separate + not reachable by us)
→ **Profile → API Keys → Create** → paste into the vault as `ELEVENLABS_API_KEY`.
Verify: `/.netlify/functions/elevenlabs-check?secret=ADMIN` → shows your character quota.
**Built + ready** (`_lib/elevenlabs.js` + `elevenlabs-check.js`) — activates the moment the key lands.

### Submagic — get the key
submagic.co → account → **API** (docs.submagic.co) → grab the API key → vault as `SUBMAGIC_API_KEY`.
(Needs the Business+API plan for real volume; a free key works to test.) Connector wired on key drop.

### Opus Clip — the reality
Opus Clip's developer API is **enterprise-gated** (sales-negotiated, large annual commitment) —
not realistic for the shop. Two working paths instead:
1. **Web app (manual, cheap):** drop a long video in opus.pro → it auto-makes 5–10 shorts →
   download → they flow into the post queue. Best value.
2. **Make/Zapier automation:** Opus Clip publishes finished clips to a Make/Zapier connector,
   which can hand them to our post-everywhere queue. Semi-automated, no enterprise API needed.
(If clip-automation matters more than the enterprise cost, revisit later.)

## The pipeline (once keys are in)
1. **Source:** Teddy shoots a hero clip (the moat — real you on camera), OR a long video exists.
2. **Clip:** Opus Clip (web/Make) → shorts. *(or skip for a single hero clip.)*
3. **Caption + b-roll:** Submagic API (auto captions + hooks).
4. **Voice (faceless tips):** ElevenLabs API → narration.
5. **Words:** Claude (ours) → hook + caption + hashtags + phone CTA, in your voice, from real jobs.
6. **Distribute:** post-everywhere → FB (native), IG, TikTok, X, Truth, YouTube. **Already automated.**

## What's automated NOW vs waiting on keys
- ✅ **Distribution** (all 6 platforms, native media) — live.
- ✅ **Words** (hooks/captions/scripts via Claude) — ours, no signup.
- ⏳ **Voiceover** (ElevenLabs) — connector built; needs `ELEVENLABS_API_KEY`.
- ⏳ **Captions/b-roll** (Submagic) — wired on `SUBMAGIC_API_KEY`.
- ⚠️ **Auto-clipping** (Opus Clip) — web app / Make, not a direct API for us.

## Honest note on "fully hands-off"
The tools do ~90% — but AI captions/clips are worth a 10-second glance before they post
(the draft-first Approve step already gives you that). Nothing auto-publishes without you,
by design; you add your touch when you want, and skip it when you don't.
