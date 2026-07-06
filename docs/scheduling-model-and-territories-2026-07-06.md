# Scheduling model + tech territories (Teddy doctrine, 2026-07-06)

## THE SCHEDULING MODEL — SLOTS, NOT TIMES (unconventional, on purpose)
Teddy, verbatim: *"We're not giving times. We've got first spot, second spot, third
spot, fourth spot, fifth spot, sixth spot. We don't give a time. We don't know what
time — there's too many variables in between. We could let them know how many stops
are ahead of them, but we're not giving times."*

Rules:
- **NEVER give a clock time.** Not on the phone, not in a text, not on a confirmation.
  A time picked ahead is a promise we can't keep (route + variable stop lengths;
  Jimmy runs late).
- **A tech's day = an ordered route of stops: 1st, 2nd, 3rd, 4th, 5th, 6th.** The
  customer's "appointment" is a POSITION in that order, not a time.
- **What we CAN tell a customer:** the DAY, and optionally **how many stops are ahead
  of them** ("you're the 3rd stop" / "2 stops ahead of you"), plus a live arrival
  window texted the MORNING OF once the tech starts his route.
- The scheduling system's default 8 AM `scheduled_start` is a **day-anchor** — its way
  of saying "just this day, no real time." That's correct behavior. The bug is only
  when someone overrides it with a real clock time. Don't assign times.

### What this implies to build (not built yet — Danielle owns the live board)
- The board should show each tech's day as an **ordered list (drag to reorder = set
  stop order)**, not clock times.
- Customer-facing: "you're stop N of M today" / "N stops ahead of you," updated live
  as the tech completes stops. No time.
- Phone/SMS already forbidden from quoting times (Ant Inbound `no_precise_time` rule,
  shipped 2026-07-06). Next: let Ant say the stop position when asked.

## LA TECH TERRITORIES (so we never send the wrong guy to the wrong area)
Teddy, verbatim: *"Andre works all of New Orleans, Metairie, Kenner, Gretna — all of
South Shore. John works all of North Shore over to Baton Rouge, all the way across to
Slidell, and everything in between — Hammond and all that."*

- **Andre (tech 3) = SOUTH SHORE:** New Orleans, Metairie, Kenner, Gretna, Westwego,
  the whole south side of the lake/river.
- **John (tech 6) = NORTH SHORE → BATON ROUGE:** Mandeville, Slidell, Hammond,
  Ponchatoula, Denham Springs, Baton Rouge metro, Walker, and everything in between.

### Routing config status (checked 2026-07-06 via check_service_zone)
CORRECT today: LA South zips → Andre; LA North + LA West (Baton Rouge) zips → John.
GAP: these Baton-Rouge/Livingston-area zips are UNMAPPED (covered=false, no tech) so
they fall through to a manual/wrong pick — the likely source of "Baton Rouge landed on
Andre." They should all be added to John's LA West cluster:
- 70791 Zachary, 70714 Baker, 70739 Greenwell Springs, 70744 Livingston
- (CLAUDE.md also flagged 70812 as unmapped Baton Rouge.)
Fix = add these zips to the LA West cluster (John rank-1). Config change, not a live-
board edit. Pending Teddy's OK.

## OPERATING NOTE (Teddy 2026-07-06)
Claude stays OFF the live scheduling board — Danielle owns scheduling and assignment.
Claude only touches a job when Teddy explicitly asks. Claude's lane: the AI phone/
messaging, backend/config fixes (like the zip mapping above), and diagnostics.
