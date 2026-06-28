# Tech Profile Interview — the foundation of self-scheduling (2026-06-28)

Ant calls each technician, interviews him like a person, and builds a rich profile so
every day is built around HOW HE WANTS TO WORK — a day he can run with pride.
Hard constraints are honored absolutely; soft preferences are optimized around.

## The profile Ant builds (the output)
**Hours & pace**
- Earliest he'll start · latest he'll work · ideal start time
- Comfortable stops/day vs. absolute max · likes a packed day vs. steady
**Days**
- Recurring days OFF + the reason (e.g. "Tuesday — wife's off") → HARD, always protected
- Soft day preferences (prefers Mon/Wed busy, light Fridays)
- Weekend willingness
**Life windows (work around these)**
- Kids/school (e.g. no 7am, must be free 3pm Tue/Thu) · lunch · standing commitments
**Geography**
- Home base · areas he prefers · how far he'll drive · areas to avoid
**Skills**
- Appliances/brands he's strongest on (route the meaty ones here) · ones he'd rather hand off
**The human bar**
- "What makes a day GREAT for you?" · "What makes a day frustrating?" (the avoid-list)

Each item tagged **HARD** (never violate) or **SOFT** (optimize toward). That tag is what
the scheduler reads.

## The interview (Ant calls the tech — warm, conversational, ~10 questions)
1. "I'm building your days around how YOU work best, not a cookie-cutter. Sound good?"
2. "What time do you like to START — and how early is too early?"
3. "How late are you good to work on a normal day?"
4. "What's a GOOD full day for you — how many stops? And what's just too many?"
5. "Any days you need off on the regular? Tell me why so I always protect it." *(captures the Tuesday/wife case as HARD)*
6. "Anything in your day I should always work around — kids, school pickup, lunch, anything?"
7. "What areas do you like to stay in? How far are you willing to drive on a normal day?"
8. "What machines are you strongest on? Any you'd rather I hand to someone else?"
9. "Saturdays — ever, never, or only if it's worth it?"
10. "Last one: what makes a day feel GREAT to you — and what makes one frustrating?"

→ Ant turns the answers into the structured profile above, tags hard vs soft, and reads it
back: "So I've got you: start 8, off Tuesdays for family, Murfreesboro area, strong on
Samsung/LG, max 6 stops, hate backtracking. I'll build your days around that. Good?"

## How it powers scheduling
The auto-place engine (`computeOffer`/constraints) already reads tech availability + capacity.
We extend it to read this profile: **HARD constraints filter days/slots out entirely** (never
offer Tuesday); **SOFT prefs score the options** (prefer his areas, his strong appliances, his
pace). Result: a productive, route-smart day that fits his life → he runs it with pride.

## Build pieces
1. **Profile store** — extend the existing tech-preferences (max_stops_per_day, works_saturdays,
   appliance_specialties, brand_exclusions, home_zone) with the new fields + hard/soft tags.
2. **The interview** — an outbound Vapi assistant ("Ant — tech setup") that calls each guy,
   runs the script, and writes the structured profile (transcript → fields).
3. **Wire profile → scheduler** so hard filters + soft scoring drive auto-place.
4. **A simple profile view/edit** so Teddy (or the tech) can correct anything Ant got.

## Open for Teddy
- Approve / edit the 10 questions above (add anything you want every guy asked).
- Confirm it's a real **Vapi phone call** to each tech (vs. a text-form they fill).
- Anything that should ALWAYS be a hard rule for everyone (e.g. no weekends unless flagged).
