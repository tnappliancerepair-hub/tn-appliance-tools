# 🐜 Group-outreach playbook — comments, DMs, and referral share copy (post as James "Teddy" Pivacek)

The trade converts on **peer credibility, not ads.** You're a real appliance-shop owner answering other
owners — that's the whole edge. This is your ready-to-paste kit so you drop a sharp, honest reply in 10
seconds every time these questions come up (and they come up constantly in Appliance Alliance Group /
Appliance Pro Talk / Appliance Technicians Only). **Rule: only true claims — honesty is the brand.**

**Your links:**
- See it / the tour: **tnapplianceexchange.net/ant**
- Your Ant Army referral link (you refer a shop → $25/mo off your bill, 4 = free): **tnapplianceexchange.net/platform/signup.html?ref=tn-appliance-exchange-llc**
- TK's reseller link (cash affiliate): **tnapplianceexchange.net/platform/signup.html?ref=TK**
- Hear Ann answer live (for warm prospects / DMs): **(615) 588-9400** — she'll pick up 24/7.

---

## 1. Recurring GROUP COMMENTS (paste when the question fits)

### A) "Which software do you use for inventory / parts?"
> Serviceworks is solid for straight parts tracking. What worked better for us was tying every part to the
> actual job instead of a separate list — which distributor it's coming from, ordered vs on-hand, cost vs
> what we charge, where it's sitting (customer's, shop, or the truck), and used vs return-to-vendor. Office
> and field see the same record, no double entry.
>
> Full disclosure — I run TN Appliance Exchange and we got tired of duct-taping tools together, so we built
> our own (AssistAnt) and now other shops run on it. Not hijacking your thread — if parts is the pain, happy
> to show you how we handle it. tnapplianceexchange.net/ant or DM me. 🐜

### B) "Does anyone use AI to triage / answer the phone?"
> The reliability comes from the rules, not from hoping the tool "thinks like you." The piece that fixes a
> no-appliance-experience assistant: the right AI carries the appliance knowledge itself. Ours answers 24/7,
> pulls brand/model/symptom/age/warranty, and because it's grounded in real closed jobs it already knows
> "this symptom on this brand = bring this part" — nobody hand-applies a rule. Books it with the right line
> items; your assistant just oversees it.
>
> And it keeps getting better: every tech + shop that joins feeds the diagnostic brain, so it's a hive mind —
> the more of us on it, the sharper "what usually fixes this" gets for everybody. Your jobs make it smarter,
> and you get everyone else's hard-won fixes back.
>
> Full disclosure — I run TN Appliance Exchange and built this for my own shop; other shops run on it now.
> Take a look: tnapplianceexchange.net/ant — or DM me and I'll show you. 🐜

### C) "What do you use to run the whole business / book jobs / schedule?"
> Honestly we ran on Housecall Pro / a pile of tabs for years and hated it. Built our own — one screen for
> the day, AI answers every call 24/7 and books it, customer gets texted back + a status link, parts and
> warranty tracked on the job. $100 flat a month, every tech included (not per-seat), and you can bring your
> book over off HCP/Jobber/Workiz in an afternoon and keep the old one running till you're sure. I run an
> appliance shop, not a software company — happy to just show you. tnapplianceexchange.net/ant or DM. 🐜

**Group etiquette:** if the group is strict about links from non-members, drop the URL and end with "DM me" —
the thread's already warm, the DMs come to you either way. Don't paste the same comment twice in one group.

---

## 2. 1:1 DM OPENERS (for owners already engaging your threads)

**To Ken King** (asked about AI triage for his no-experience office assistant):
> Ken — saw your triage question. That's exactly the problem I built for. My AI answers 24/7 and does the
> triage itself (grounded in real closed jobs), so my office person doesn't need appliance experience — she
> just oversees it. Want a 2-min look at how it'd handle your calls? No pitch, I'll just show you. Here's a
> 60-sec clip: [video] — or call the AI yourself at (615) 588-9400 and hear it.

**To Marc Lavelle** (already runs an AI phone agent + HCP + written rules — a peer, not a prospect; be a colleague):
> Marc — loved your answer on that thread, you've got it dialed. We built ours a step further: the triage
> rules aren't hand-written, the AI carries the appliance knowledge from real closed jobs and it's shared
> across shops, so it gets sharper over time. Not trying to sell you off what's working — genuinely curious
> what you're running and happy to compare notes. What's your setup?

**To Jessica Anne** (asked Marc "what AI app do you use?"):
> Jessica — saw you asking what AI app to use. I run an appliance shop and built my own after nothing off the
> shelf fit — answers 24/7, books the job, tracks parts + warranty, $100 flat all techs. Happy to show you a
> 60-sec look, no pressure: [video] or tnapplianceexchange.net/ant. Want me to walk you through it?

**Generic warm-lead DM** (anyone who liked/commented/shared):
> Hey [name] — appreciate you checking out AssistAnt. I run TN Appliance and built it for my own shop; other
> shops are on it now. Want the 60-sec look, or should I just set your shop up free alongside your current
> system so you can see it on your own jobs? Your call — no pressure.

---

## 3. REFERRAL SHARE COPY (turn happy shops + TK into your salesforce)

**When you refer a shop yourself (Ant Army — $25/mo off your bill per active shop, 4 = your system's free):**
> If you know a shop drowning in phone calls, send them this — tnapplianceexchange.net/platform/signup.html?ref=tn-appliance-exchange-llc
> — they get free setup + their data brought over, and it knocks $25/mo off my bill. Win-win.

**Ask a happy customer to refer (once you have a few running on it):**
> Glad it's working for you. Two things: leave me an honest review, and if you know another shop owner send
> them your referral link from your owner dashboard — every shop you bring on knocks $25/mo off YOUR bill,
> and four makes your whole system free.

**TK's reseller pitch (his cash link):** TK shares **signup.html?ref=TK**; his read-only dashboard is
**partner.html?token=pt_2e274606b78803f0c1db43c52f3adbb3**.

---

## ⚠️ Two things for you to set (they affect the referral numbers)
- **TK's commission % is still blank** in the system, so his dashboard reads $0 until you set it. When you
  land on his number, one command locks it in:
  `platform-partner?do=upsert&code=TK&commission_pct=<N>&commission_months=<0=lifetime|N>&secret=<admin>`.
- **The Ant Army $25 credit is tracked + shown, but not yet auto-applied to Stripe** — attribution and the
  dashboard are live (every referred shop is correctly counted), but the actual bill credit is a separate,
  money-touching build we do on your go. So today the referral link fully WORKS to attribute + track; the
  auto-discount flip comes when you want it turned on.
