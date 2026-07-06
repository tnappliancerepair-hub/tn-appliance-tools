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

## ✅ FIXED — 2026-07-06 (afternoon, live-field with Teddy in Clarksville)
| Bug | Cause | Fix |
|---|---|---|
| Started job "disappeared," no Complete button | A started tile swaps its buttons (Start → "✓ Done — file report"); techs didn't recognize it | Relabeled to **"✅ Complete this job"** + "⏳ Started — tap Complete when you're done" hint |
| "Job already completed" on a return visit (couldn't record the real repair) | `tech_job_complete` stamps `job_completed_at` on EVERY completion type, so the first diagnostic/parts trip marked the job "done" → idempotency gate blocked the return trip | **`tech-complete` wrapper**: non-terminal completions (parts/warranty-auth/reassign) strip the "done" stamp back off; a stale blocking stamp is cleared before completing (+retry). Routed job-page + tile completion through it |
| "Complete" button ambiguous (diagnostic vs job-done) | One button, no distinction | Picker relabeled: **"✅ Fixed it — job complete"** vs **"🔩 Diagnosed — need parts, coming back"** + explainer that diagnostic keeps the job open |
| Complete/Start greyed out on a return visit | `applyLifecycleButtons` greyed from raw prior-trip timestamps | Now greys a step only if it happened **today** — a prior-trip stamp no longer disables this visit's buttons |
| TDR field editor had no visible Save (only ×) | Save button sat below the input, hidden by the phone keyboard | **Green ✓ Save in the editor header** (always above the keyboard) + green ✓ at bottom; × clearly cancels |
| (data) Colston #19789 + #19708/#19822 stuck "completed" | stale flags from prior trips | cleared via reset-job-lifecycle (now also clears `job_completed_at`) |

**⏳ Proper XS follow-up (needs a Mac push):** fix `tech_job_complete.xs` to NOT stamp
`job_completed_at` for non-terminal completion types (parts_needed / warranty_auth_needed
/ reassignment_needed), and scope the idempotency gate to truly-terminal status. The
`tech-complete` wrapper does this live today; the XS change makes it native.

## 🔎 PROACTIVE SWEEP — 2026-07-06 (done; fixes shipped)
Deep read-only audit of the tech surfaces found the field-killers below. Two root
causes drove most of the HIGH list: **no fetch timeouts** (a hung request on weak
signal froze buttons forever) and **full-page re-renders that discarded the tech's
unsaved report** (the report = his pay).

### ✅ FIXED same-day
| Sev | Bug | Fix shipped |
|---|---|---|
| HIGH | Hung request on weak signal → button stuck on "Saving…/Completing…" forever, no recovery | `fetchT` 15s AbortController on every API call in tech-job + tech-dashboard; a hang now rejects → catch re-enables the button |
| HIGH | `completeFlow` accepted a *typed* report to pass the gate but never SAVED it → report vanished on the post-complete reload | Persist the typed report via `create_tdr` BEFORE completing |
| HIGH | Any `loadJob()` re-render (model-photo OCR, lifecycle tap, save-basics) wiped unsaved notes | Preserve the notes textarea value across re-render |
| HIGH | Dashboard "File your report" showed "✓ you're getting paid" even when every write silently failed on weak signal | Track `savedOk` from the write responses; tell the tech to retry instead of falsely confirming |
| HIGH | Weak-signal PIN unlock had no timeout → app stuck on "loading your day…" with no PIN screen | `fetchT` on verify-pin / office-password → a hang falls through to the existing degraded unlock |
| MED | Office notes attached to the WRONG customer's card (filtered-list index vs `card-<originalIndex>`) | Iterate the original jobs array so the index matches the card |

### 📋 OPEN — queued for the coming days (ranked)
- **#6/#9 (MED): return-visit lifecycle on the job page.** `applyLifecycleButtons` greys On-my-way/Start/Complete from raw prior-trip timestamps, and the tile-finish + tech-job Start/Complete still post straight to Xano instead of through `/tech-lifecycle`. Route them through the wrapper so 2nd/3rd/4th trips aren't greyed/blocked.
- **#7 (MED): `loadJob` failure shows an error with no Retry button** (dashboard has one; job page doesn't). Add a retry.
- **#8 (MED): a job link missing `tech_id` = PIN screen that can't validate and covers the back button** (dead-end). Add the office-password fallback like the dashboard.
- **#11 (MED): voice transcribe has no timeout** → mic flow can hang on "Transcribing…". Wrap `whisper-transcribe` in `fetchT`.
- **#13 (MED): S3-fallback upload has no timeout/retry** → large photo on weak signal hangs on "Uploading…". Add timeout/retry to the direct-PUT fallback.
- **#10 (mitigated): SW serves stale HTML** — now covered by `tech-autoupdate.js` (one-tap Update). Optional: make the SW HTML strategy match its "always fresh" comment.
- **#14 (LOW): `tech-simple.html` registers `/tech-sw.js`** (different SW than `/sw-tech.js` everywhere else) — unify.
- **#15 (LOW): `prompt()`/`confirm()`** for cash method / deletes can be suppressed in installed-PWA webviews → silent wrong-default. Replace with in-page controls.
- **#16 (LOW/sec): raw PIN / office password cached plaintext in localStorage** — a handed-off phone leaks it.

---
*Changelog: 2026-07-06 created; seeded with the day's 5 fixes + kicked off the sweep.*
