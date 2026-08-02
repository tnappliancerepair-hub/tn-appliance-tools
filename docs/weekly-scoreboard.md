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

## Development approach — think it through, over several weeks (Teddy 2026-08-02: "This should be thought out over several weeks")

**This is a design/thinking effort, not a build sprint.** The scoreboard is the
instrument the whole business will steer by — a wrong metric here doesn't just
mislead, it makes the team chase the wrong thing. So we take weeks to think it
through, one question at a time, and only build once the thinking is settled.
No code until the design is right.

E-Myth order still holds — **Innovation → Quantification → Orchestration** — but
each is something to *reason about* first, not ship on a clock. The questions
worth sitting with, roughly in order (Teddy drives the tempo — could be one a
week, could be slower):

### 1 — Purpose & the one number
What is this scoreboard actually *for*? What single number means "we had a good
week"? (Draft leaning: cash **collected**, because it funds payroll — but that's
a question, not a decision yet.) Everything else serves that one number.

### 2 — The right *few* metrics (kill the vanity ones)
Which handful of numbers actually change a decision? A number that no one would
*act* on doesn't belong. Challenge every candidate: "if this went red, what
would we do?" If the answer is nothing, cut it. Fewer, truer numbers beat a
wall of dials.

### 3 — Perverse incentives
For each surviving metric: how would someone game it, and what bad behavior
might chasing it cause? (e.g. "first-visit-fix" could push a tech to call a job
done that isn't; "jobs completed" could reward rushing.) Design the metric — or
its pairing — so the honest path is the winning path.

### 4 — Definitions & data honesty
Pin the exact definition of each term (what *is* a "lead"? when does the
intake→done clock start/stop? collected vs booked?). Then confirm each number
can be trusted — some feeds are noisy or partial. A number we don't trust is
worse than no number.

### 5 — Targets from reality (not guesses)
Only after watching real numbers for a couple weeks do we set targets — off the
actual baseline, not the SAMPLE placeholders in this doc. A target pulled from
thin air just manufactures a fake red.

### 6 — The ritual & who owns it
Who reads the scoreboard, when, and what do they *do*? Is the President/COO seat
Teddy, a lead, or Ant running the play? The ritual is the whole point — the
numbers only matter if they reliably turn into one action each week.

### 7 — Then build
When the above is settled, *then* we wire `weekly-scoreboard.js` (observe mode
first, banking real snapshots), add colors/targets, the decision layer, and the
Monday text — mirroring the nightly-scorecard pattern already in the repo.

*This is a living thinking-doc. As each question gets answered, record the
decision here so it persists across sessions.*
