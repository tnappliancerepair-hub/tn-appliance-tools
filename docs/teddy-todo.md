# Teddy's To-Do — open action items (things that need YOU)

_Running list. Newest/most-active up top. Started 2026-07-10 (Kentucky drive)._

---

## 🟢 1. Turn on Google Business Profile messaging + welcome greeting
**Why:** map-pack chats auto-redirect to Ant's instant text line (speed-to-lead).
Manual toggle — Google killed the API for this, so it's a 90-second phone job.

**Steps (on your phone, signed in as the business owner):**
1. Open the **Google Maps app** → tap your profile pic (top right) → **Your Business
   Profile** → **TN Appliance Exchange**.
2. Find **Messages / Chat** (may be under "Edit profile" or a chat-bubble icon) →
   **Turn on messaging**.
3. In messaging **Settings → Welcome message**, paste this (fits Google's 120-char cap):

   > **Thanks for reaching out! For the fastest 24/7 answer, text 615-588-9500 — Appliance Ant replies in seconds 🐜**

**Caveat:** Google can disable messaging if you don't respond within 24h, so have
you or Danielle glance at that Maps inbox once a day for stray replies. The greeting
does the heavy lifting (bounces them to the AI text line).

---

## 🟡 2. Post the 3 self-pay Q&As on your Google profile
**Why:** pre-answers the exact hesitation that makes a cash customer scroll past.
Google keeps owner Q&A in the app, so it's a paste job (or have Danielle/Alec post
the questions and you answer).

**Where:** Google Maps → search TN Appliance Exchange → **Questions & answers** →
**Ask a question** (paste Q) → then tap **Answer** (paste A). Three times.

- **Q1:** Do you work with customers who don't have a home warranty?
  **A1:** Absolutely — most of our repairs are paid out of pocket. You'll get flat,
  upfront pricing and see every option before we do anything, including installing
  the part yourself. No warranty required, no surprises.
- **Q2:** How much does a repair cost if I'm paying myself?
  **A2:** We quote flat, honest pricing up front — you know the number before we
  start, never a surprise at the end. For $50 you can even get a live video
  diagnostic first, and that $50 goes toward your repair. You always see all your
  options, including DIY with a part we ship you.
- **Q3:** How fast can I get help, and how do I start?
  **A3:** Right now, 24/7. Text or chat with Appliance Ant, our AI assistant — it
  answers in seconds any time. Send a quick video of the problem, get a diagnosis
  and options fast, then we schedule you. No hold music, no phone tag.

---

## 🟡 3. Amazon Ordering API → Production (the keystone for pre-order parts)
**Why:** unlocks the whole pre-order-parts flywheel + the AHS parts margin. Gated on
Amazon promoting the app.

- In the Amazon **Solution Provider Portal (SPP)** → your app **"TN-Appliance-Ordering"**
  → **Edit App** → find the **Sandbox → Production** toggle/status and promote it.
  (If no self-serve button, it's Amazon's approval — contact SPP support.)
- Add your **current card** as the **default** payment method (the expired ••4689 was
  removed; the API charges whatever's default).
- Then tell Claude → he mints the production token, flips env, and runs a no-buy trial.

---

## 🔴 4. Bring customer intake texts back on (needs the Mac)
**Why:** texts are OFF right now (emergency stop for the arrival-time spam). No spam
while you're gone — but new-lead intake texts are paused too.

- Whoever's at the **Mac Mini** runs:
  `cd ~/tn-appliance-tools && git pull origin main && launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop`
- Then tell Claude → he flips the customer gate back ON. Result: intake/availability
  texts flow again, and clock/arrival times NEVER go out (fixed in the new loop code).

---

_Captured by Claude during the 2026-07-10 Kentucky-drive session. Ask Claude to
re-surface this list anytime._
