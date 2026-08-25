# 🌙🐠 Reef & Aquarium Service — To The Moon (strategy)

**Thesis (2026-08-25):** an aquarium/reef maintenance business is not a fish store with a
phone — it's a **recurring-revenue route service business**, which is a fundamentally
better business than one-off repair. Apply the exact Ant playbook (answer everything,
catch the emergency, know the customer, predict the failure, close the loop) to
reefkeeping, and every step is *stickier* than appliances because the same tanks renew
forever. Build toward the recurring engine from day one. This doc is the living plan —
edit it, commit, push; keep the changelog at the bottom current.

Owner context still to fill: this shop is a friend of Teddy's — a **fish/pet store that
also services tanks**. Fork to resolve before we lead (see Open Questions): is he mostly
**retail** (walk-in store) or mostly **service** (route accounts), and does he want to
grow the route side?

---

## Why reef is a better business than appliance repair
- **Recurring, not one-and-done.** Appliance repair earns a ticket and the customer
  disappears for two years. Reef maintenance is a **route** — the same tanks every week
  or month, indefinitely. Predictable revenue that compounds and can be **sold** (a book
  of recurring contracts is an asset; a pile of past repairs is not).
- **High-value, sticky customers.** Doctors' and dentists' offices, restaurants, corporate
  lobbies, wealthy homeowners with display/reef tanks. A large reef contract is
  **$200–500+/month**, and switching costs are high (nobody wants a new person learning
  their $5k reef from scratch).
- **High stakes = high trust = high retention.** A crashing reef means thousands of dollars
  of living coral and fish dying, fast. Whoever answers the panic call and shows up wins
  the customer for life. Voicemail loses them.
- **Knowledge-intensive = a real moat.** Water chemistry (salinity, alkalinity, calcium,
  magnesium, nitrate, phosphate), livestock compatibility, disease, equipment, dosing.
  This is exactly the kind of domain where a **data-grounded troubleshooting brain**
  becomes an uncopyable advantage.

## The seven levers ("to the moon")

**1. Never miss the panic call.** The after-hours "my tank is crashing, fish are dying"
call is the highest-stakes, highest-retention call in the trade — and it lands when
competitors are at voicemail. Ann answers 24/7, triages urgency ("is this an emergency"),
and blasts the owner instantly. Winning these is the fastest way to steal customers from
every shop that lets the phone go to voicemail.

**2. Recurring routes are the money machine.** The platform becomes a **route scheduler**:
weekly/biweekly/monthly service auto-books itself, the tech runs the route, the customer
portal shows "next visit + last readings." This is the pool-service model applied to reef,
and it's what turns a shop into a valuable, sellable asset. The recurring engine is the
spine everything else hangs on.

**3. The tank becomes a living record — this is the moat.** Every service visit logs the
water: salinity, alkalinity, calcium, magnesium, nitrate, phosphate, temperature, dosing,
equipment, livestock. Over months each tank has a **health chart**. That's the reef version
of our appliance brain's "on THIS exact model, here's what fails" — except now it's
**"on THIS tank, alkalinity crashes when X."** Which unlocks the killer move:
**flag a tank trending toward a crash before it crashes** — predictive crash-prevention.
Nobody in this trade has it, because nobody else has the accumulated route data. **The
routes are the moat.**

**4. The reef troubleshooting brain.** Cyanobacteria, dinoflagellates, algae blooms, coral
bleaching, fish disease, cloudy water — the customer or tech describes it (or snaps a
photo, the reef version of our model-sticker OCR but for diagnosis), and Ant returns a
grounded fix from reef chemistry + *that tank's own history*. The most advanced reef
troubleshooting brain, same architecture as the appliance one, fed by the route data.

**5. The retail ↔ service flywheel.** Every visit and portal message is an upsell:
"your softies want more flow — grab a powerhead," "RODI filters are due," "new frag that
fits your tank." Service sells retail; retail sells service; livestock sells both. Same
install-add-on engine we already built for appliances, applied to a shop that also sells
product.

**6. The water-test funnel.** Free or cheap water testing (in-store or mail-in) → the
result flags a problem → "want us to come fix it?" That's the "$50 Quick Check"
acquisition funnel, reef edition — turn a $0–20 test into a recurring service account.

**7. The real moon — a vertical SaaS for the whole trade.** There are **thousands** of
local reef/aquarium maintenance businesses nationwide, nearly all running on spreadsheets
and text messages. The recurring-route scheduler + tank-health brain + customer portal
*is a product*. TN Appliance proved the model; this shop proves the aquarium vertical;
then we sell "Ant for aquarium service" to every shop in the country. Same "database for
the masses" play, new trade.

## The moat, stated plainly
Recurring routes → a water-parameter record per tank over time → a data set of real tanks
nobody else has → a reef brain that **diagnoses and predicts crashes** → which makes the
service better → which wins and keeps more routes. It's the same compounding flywheel as
the appliance brain (49k HCP jobs + every TDR), applied to reefkeeping. A competitor with
ChatGPT can clone a screen; they cannot clone the tank histories.

## Honest hard parts (so we build smart)
- **Water chemistry is genuinely complex and high-variance.** The brain must start
  **grounded and humble** — say "I don't know, get it tested" before it ever guesses.
  Let the route data make it smart; don't over-promise the AI early.
- **The stakes are living animals.** A wrong call kills coral. Trust is earned slowly;
  one confident-but-wrong answer on a $5k reef is worse than none. Ground every claim.
- **Retail + service + livestock is a more complex mix** than pure service. Keep the first
  build focused on the service/route spine; don't try to run the whole store on day one.

## Sequencing (crawl → walk → run)
- **Crawl (now):** Ann answering + the office board for this one shop. Catch the emergency
  call, capture the lead, jobs on a board. Same stand-up as Greg (add an `aquarium` trade
  row — one row, no rebuild; the "unit" becomes a **tank**: gallons, fresh/salt/reef,
  location, livestock).
- **Walk:** recurring routes + the tank-as-unit carrying a **water-params record per
  visit** + the customer portal showing next-service and readings. This is the
  recurring-revenue engine and the data that feeds the moat.
- **Run:** the reef brain (diagnosis + predictive crash-prevention) fed by the route data,
  then packaged as the **aquarium-service vertical SaaS**.

## How this fits the bigger Ant picture
This is the second proof that the platform is genuinely **trade-agnostic** (appliance →
automotive → aquarium, each a new `trade_profile` row, never a schema change). Each new
trade that slots in cleanly de-risks the SaaS thesis and widens the moat: one brain
architecture, many verticals, all feeding the same "most-educated-servicer-alive" engine.
Reef is an especially good vertical to own because it is recurring, high-value,
knowledge-intensive, and currently un-automated.

## Open questions / what shapes the plan
1. **Retail-heavy or service-heavy today?** Decides whether we lead with the
   emergency-catch (retail) or the route-scheduler (service).
2. **How many recurring service accounts does he have now, and does he want to grow the
   route side?** The route count is the leading indicator; growing it is the whole game.
3. **Fresh, salt, reef — or all three?** Reef is the highest-value, highest-stakes, and
   most knowledge-intensive; it's where the brain earns its keep.
4. **Does he do emergency/on-call service today, or lose those calls?** The after-hours
   catch may be the single fastest win.
5. **Own line or forward the store line; Ann on all calls or after-hours only?** (The
   standard trial-Ann stand-up questions.)

## Next actions
- Collect the 6 stand-up details from the owner (name, cell, hours, service area, about
  block, number plan) — same as Greg/Jake.
- Pre-add the `aquarium` trade to the platform so he's a one-command stand-up.
- Crawl: stand up his Ann + board. Then design the route scheduler + tank-params record.

---

## Changelog
- **2026-08-25** — Created. Captured the reef/aquarium-service moonshot from the strategy
  discussion: recurring-route thesis, seven levers, the route-data moat, honest hard parts,
  crawl/walk/run sequencing, and open shaping questions. (Teddy + Claude.)
