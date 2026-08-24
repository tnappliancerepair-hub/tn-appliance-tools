// trial-shops — the registry of FREE-TRIAL Ann tenants (other shops we're standing
// an "Ann answers your phone 24/7" pilot up for). This is the deliberately SIMPLE
// tier: Ann answers, captures the lead, and texts it straight to the shop owner. No
// customer database, no scheduling board, no warranty flow — that's the full Ant.
//
// A trial shop is one entry below. To stand a shop up the moment their details land:
//   1) add an entry here (slug = short lowercase handle),
//   2) commit + push (Netlify auto-deploys),
//   3) hit trial-ann-admin?action=create&shop=<slug> -> returns assistant_id,
//   4) trial-ann-admin?action=bind&id=<assistant_id>&number=+1<their line>.
//
// Fields:
//   name        spoken business name, said in full ("Classic Automotive")
//   type        'appliance' | 'automotive'  (drives which persona template Ann uses)
//   ownerFirst  the owner's first name (Ann can say "I'll get this straight to Greg")
//   ownerCell   E.164 — where the lead text lands (their phone). REQUIRED.
//   area        service area phrase ("the Greater Nashville area")
//   hours       human-hours phrase ("Monday to Friday, 8 to 5") — Ann answers 24/7,
//               but tells callers when a person follows up.
//   autoScope   automotive only: 'general' (all makes/repairs) | 'classic'
//               (classic / restoration focus) — tunes how Ann talks about the work.
//   greeting    optional custom opening line; blank = a warm default is generated.
//   about       optional — a few plain lines of what Ann can ANSWER for callers
//               (services offered, what they do/don't work on, general hours, rough
//               pricing the owner is OK with her sharing). Makes her a real CSR, not
//               just a lead-catcher. She answers ONLY from what's here; anything past
//               it she routes to a callback. Leave blank = she captures + hands off.
//   platformSlug optional — the shop's Supabase tenant slug (docs/multi-tenant-platform).
//               When set (and the platform is configured), every lead Ann captures ALSO
//               becomes a JOB on that shop's office board + a customer portal link. This
//               is the phone→database bridge. Leave blank = SMS-to-owner only.
'use strict';

const SHOPS = {
  // ── Joey Grover — appliance repair. Uncomment + fill the FILL_ markers, push,
  //    then trial-ann-admin?action=create&shop=joey  →  &action=bind&id=…&number=+1…
  // 'joey': {
  //   name: 'FILL_business_name',        // said in full on the phone
  //   type: 'appliance',
  //   ownerFirst: 'Joey',
  //   ownerCell: '+1FILL_owner_cell',    // E.164 — REQUIRED, lead texts land here
  //   area: 'FILL_service_area',         // e.g. 'the Greater Nashville area'
  //   hours: 'Monday to Friday, 8 to 5',
  //   about: 'FILL_what_she_can_answer', // services / brands / rough pricing she may share
  //   platformSlug: '',                  // set to their Supabase tenant slug for the board+intake bridge
  // },

  // ── Greg Long — Classic Automotive, Lebanon TN. Automotive persona captures
  //    year/make/model. ⚠️ NEEDS Greg's cell (ownerCell) to go live — that's where
  //    the lead texts land. Confirm autoScope: 'classic' vs 'general' with Greg.
  'greg': {
    name: 'Classic Automotive',
    type: 'automotive',
    ownerFirst: 'Greg',
    ownerCell: '+16158549602',          // Greg's cell — lead texts land here
    area: 'Lebanon, Tennessee and the surrounding area',
    hours: 'Monday to Friday, 8 to 5',
    autoScope: 'general',               // confirm 'general' (all makes) vs 'classic' (restoration)
    about: '',                          // optional — services/pricing Ann may share
    platformSlug: '',
  },
};

function get(slug) {
  const s = SHOPS[String(slug || '').toLowerCase().trim()];
  return s ? Object.assign({ type: 'appliance', autoScope: 'general', hours: 'Monday to Friday, 8 to 5', about: '', platformSlug: '' }, s) : null;
}

module.exports = { SHOPS, get };
