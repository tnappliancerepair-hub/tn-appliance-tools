# TN Appliance Exchange — Weekly Scoreboard (E-Myth Management System)

*Internal working document · v0.1 draft (2026-08-02) · SAMPLE numbers · targets are Teddy's to set*

The companion to the org chart (`docs/emyth-org-chart.md`). The org chart says
*who owns each box*; this scoreboard is the **management system** that lets the
President/COO box run **off numbers instead of off Teddy**. In E-Myth terms:
the business tells you what needs attention, so anyone — or Ant — can run the
weekly play.

Rendered, theme-aware version (private Artifact):
`https://claude.ai/code/artifact/bdc221a2-f651-4719-83b9-9a167e9d752a`
(re-publish `scratchpad/weekly-scoreboard.html` to that URL to update).

---

## Shape

1. **The one number** — money collected this week vs target, with trend.
2. **The one red number** — auto-picked: the metric furthest below target, with
   the single action that fixes it and one owner by Friday. *This is the
   decision layer — the whole point.*
3. **Four bands of vital signs** — Operations, Marketing, Finance, Knowledge/Moat
   — each card: value · target · trend (▲▼▬) · status (green/amber/red) · source.
4. **The weekly ritual** — 5 minutes every Monday, 3 questions, one plan.

Status = vs target (🟢 on/above · 🟡 watch · 🔴 below → act). Trend = vs last week.

---

## The metrics (SAMPLE values — Week of Jul 27–Aug 2, 2026)

### THE ONE NUMBER
**Money collected this week: $18,240** of $20,000 target (91%, ▲ from $16,900).

### THE ONE RED NUMBER
**First-visit-fix 68%** (target 80%, ▼). 15 second-trip jobs = double drive-time,
half commission per fix — the biggest drag on the money number.
**Action:** pull the 15 second-trip jobs (Ant logs each), tag the cause
(wrong part / missed diagnosis / no access), put the top cause on Monday's tech
huddle. Owner: Ops lead, by Friday.

### OPERATIONS — *owned by Ops lead (Danielle + techs + Ant)*
| Metric | Sample | Target | Source feed |
|---|---|---|---|
| First-visit-fix % 🔴 | 68% ▼ | ≥ 80% | TDR outcomes + repeat-visit flag |
| Jobs completed | 47 ▲ | ~45/wk | job board (completed status) |
| TDR complete before pay 🟡 | 94% ▲ | 100% | TDR-completeness gate |
| Days intake→done 🟡 | 3.8 ▬ | ≤ 3.0 | job timestamps |
| Dropped/stranded jobs | 0 ▬ | 0 | board-audit banner |

### MARKETING — *owned by Marketing (Ant + Ann + office)*
| Metric | Sample | Target | Source feed |
|---|---|---|---|
| New leads | 62 ▲ | ~55/wk | lead-report (by source) |
| Lead→booked % 🟡 | 41% ▼ | ≥ 45% | lead-attribution → jobs |
| Cost per booked job | $0 ▬ | free-channel (ads paused) | ad spend ÷ booked |
| Phone trust score 🟡 | 84 ▲ | 90 (baseline 77) | phone-trust-scorecard |
| Reviews added | 6 · 4.8★ ▲ | ≥ 5/wk | GBP reviews feed |

### FINANCE — *owned by Finance (office + Ant + Alyse)*
| Metric | Sample | Target | Source feed |
|---|---|---|---|
| Revenue collected 🟡 | $18.2k ▲ | $20k | payments / invoice paid |
| Unpaid invoices 🟡 | 9 · $2.2k ▬ | < 8 open | list-invoices / AR aging |
| Warranty filed→paid | 92% ▲ | — | claims-sync reconcile |
| Gross margin | 61% ▲ | ≥ 60% | P&L rollup (Digits) |
| Parts margin | 26% ▲ | ~25% (cost ÷ .75) | parts ledger vs invoiced |

### KNOWLEDGE & MOAT — the #1 goal — *owned by the brain (Ant)*
| Metric | Sample | Target | Source feed |
|---|---|---|---|
| Models known | 1,247 ▲ | climb weekly | knowledge-scorecard |
| First-guess part accuracy 🟡 | 73% ▲ | ≥ 80% | ant-brain-score |
| Open knowledge gaps | 14 ▼ | trend down | knowledge-gap ledger |

---

## The weekly ritual — 5 minutes, every Monday
Ant texts the scoreboard + link at **7:00 AM CT**. Whoever holds the
President/COO hat reads it and answers three questions:

1. **What's the one red number?** (the board surfaces it — don't chase all of them)
2. **What's the one action?** (smallest concrete move that fixes it this week)
3. **Who owns it by Friday?** (one name, one deadline — that's the week's plan)

Next Monday the scoreboard says whether it worked. That loop —
**red number → one action → did it move?** — *is* the President/COO seat. Run it
off the numbers and the seat stops depending on Teddy being in the building.

---

## Wiring path (when Teddy approves the shape + targets)
Every card already has a live feed inside Ant (named above) — this is
**aggregation, not new instrumentation**. Build `netlify/functions/weekly-scoreboard.js`
on the same pattern as the nightly scorecards already running
(`knowledge-scorecard.js`, `phone-trust-scorecard.js`, `office-scorecard.js`,
`markets-report.js`):

1. Pull each source for the Mon–Sun window; compute value + prior-week trend.
2. Compare to Teddy's targets; color each; auto-pick the red number (furthest below).
3. Render a `weekly-scoreboard.html` page (this design) + text the summary via a
   Monday 7:00 AM CT cron. HTTP-pullable with `?secret=&text=0` like the others.
4. Persist the weekly snapshot to event_log for trend history.

**Open before wiring:** Teddy sets the real targets (all drafts above), and
confirms the north number = *collected* (cash in) vs *revenue booked*.

---

## Development roadmap — the month (Teddy 2026-08-02: "develop this over the next month")

E-Myth order is **Innovation → Quantification → Orchestration**. You can't set
honest standards before you've watched real numbers — so we quantify first,
set targets off real baselines second, add the decision layer third, and turn
on the Monday ritual last. Four weeks:

### Week 1 — QUANTIFY (observe mode) · *in progress*
Stand up `netlify/functions/weekly-scoreboard.js` that pulls every feed for the
Mon–Sun window and renders `weekly-scoreboard.html` with **real numbers, no
targets, no colors** — just what the shop actually did. Snapshot the week to
event_log (`weekly_scoreboard_snapshot`) so trend history starts banking from
day one. Goal: confirm each feed reads cleanly, find the feeds that need work,
and produce the first *real* (not SAMPLE) scoreboard.
- [ ] Map every feed + response shape (Explore pass)
- [ ] Build the observe-mode collector + page
- [ ] First real weekly snapshot banked

### Week 2 — SET THE STANDARD (baselines → targets)
With 1–2 weeks of real numbers in hand, Teddy sets each target off the actual
baseline (not the SAMPLE guesses). Add status colors + trend-vs-prior-week now
that there's a prior week to compare. **Decision due:** north number =
*collected* vs *booked*. Fix any feed that read wrong in Week 1.

### Week 3 — THE DECISION LAYER (make the red number act)
Auto-pick the red number (furthest below target). Attach a per-metric action
template + owner, and wire the drill-down — e.g. first-visit-fix red → list the
actual second-trip jobs behind it so the huddle works from names, not a
percentage. This is what turns a dashboard into a management system.

### Week 4 — ORCHESTRATE (the Monday ritual, live)
7:00 AM CT Monday cron texts the summary + link (same pattern as the nightly
scorecards); HTTP-pullable `?secret=&text=0`; weekly snapshots drive the trend
history. Run the first real Monday rituals, tune wording + thresholds. By month
end the President/COO seat runs off the numbers.

*Progress is tracked here — check boxes as each lands.*
