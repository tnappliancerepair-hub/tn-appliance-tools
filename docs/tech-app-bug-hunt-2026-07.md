# Tech App Bug Hunt — week of 2026-07-06 (living doc)
Teddy's goal for the week: **work every bug out of the tech app from the field.**
Real bugs, found on real jobs, fixed same-day. This is the running log — every field
bug gets captured here with cause + fix + verified status so nothing slips and we can
watch the app get cleaner day by day. Fire a screenshot/voice note → it becomes a fix.

## 🔁 The loop
1. Teddy (or a tech) hits a bug in the field → sends a screenshot / voice note.
2. Claude diagnoses from the code, fixes, deploys (Netlify auto-deploy), verifies live.
3. Logged here + Teddy told what changed + any one-time action (usually: none, thanks
   to auto-update below).

## ✅ FIXED — 2026-07-06
| # | Bug | Cause | Fix | Status |
|---|---|---|---|---|
| 1 | Job file had no way to add a missing **customer phone** (Danielle) | Phone field was buried at the bottom of the edit card, off-screen | One-tap **"+ Add phone"** right on the Job File Phone row (office-board) → saves via office_quick_fill, never wipes the claim | ✅ live |
| 2 | **"On my way" button dead** on a return visit (showed "tap to retry") | `tech_on_the_way` refuses when `tech_en_route_at` is already set — but that flag was stamped on the FIRST trip and never reset | New `tech-lifecycle` wrapper clears prior-DAY flags (fresh text every trip) but keeps same-visit idempotency; day-tile + tech-job routed through it | ✅ live |
| 3 | Same stale-flag lock on **Start** for 2nd/3rd/4th trips | `job_started_at` stale from prior trip | Same wrapper clears prior-day `job_started_at` | ✅ live |
| 4 | **Waiver signature "wiggles all over, hits different letters"** (John) | Pad read `touches[0]` → a palm/2nd finger switched the active contact point mid-stroke; `ctx.scale` + stale-rect mapping also drifted the ink | Pointer-event single-pointer capture (palm rejection) + drift-proof coordinate mapping (waiver.html + sign.html); dropped sign.html's resize→wipe | ✅ live |
| 5 | **"Close and reopen to get the fix" tax** — every deploy needed a manual refresh | Service worker is stale-while-revalidate → serves the cached (old) shell; new version only shows next open | `tech-autoupdate.js` watches the page's ETag; on a new deploy shows a one-tap **"Update now"** banner (never auto-reloads, so no lost typing). Added to the 5 main tech pages + SW precache; CACHE_VERSION bumped | ✅ live |

### Note on #5 (one last manual refresh)
Auto-update ships *inside* the tech HTML, so the **first** time each tech needs to
open/refresh once to load the version that has the watcher. After that, every future
fix this week lands with a tap — no more "close and reopen."

## 🔎 PROACTIVE SWEEP — 2026-07-06 (in progress)
A read-only audit of the tech surfaces (tech-daily-dashboard, tech-job, tech.html,
tech-simple, tech-ant-chat, sw-tech) for latent field-killers: dead-ends, silent
failures, gating traps, weak-signal/offline, mobile touch/render, state/data races,
correctness. Findings get triaged into the table above as they're fixed.

_(Findings land here as the audit completes.)_

## 📋 OPEN / WATCHING
- (none yet — add as they come in from the field)

---
*Changelog: 2026-07-06 created; seeded with the day's 5 fixes + kicked off the sweep.*
