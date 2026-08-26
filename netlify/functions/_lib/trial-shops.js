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
//   type        'appliance' | 'automotive' | 'dealership'  (drives Ann's persona:
//               appliance repair · auto repair · used-car-lot sales lead capture)
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
    ownerCell: '+16158549602',          // Greg's cell — lead/message texts land here
    email: 'Gllong178@gmail.com',
    area: 'Tennessee, Kentucky, and Alabama',
    hours: 'Monday to Friday, 8 to 5',
    autoScope: 'general',               // he does it ALL — general, not classic-only
    greeting: "Thanks for calling Classic Automotive, this is Ann — I help catch Greg's calls when he's out in the shop. How can I help you today?",
    about: "Full-service auto repair based in Lebanon, TN, serving Tennessee, Kentucky, and Alabama — no job too big or too small, Greg does it all. We SPECIALIZE in wheel alignments — alignments start at $120. We also do tires (we have our own tire machine), batteries, oil changes, brakes, and general repair, all the way up to complete restorations. Multiple lifts. We offer a FREE diagnostic with any repair. Greg goes over exact pricing himself when he calls back.",
    platformSlug: 'classic-automotive', // FULL tenant on the Ant platform: every lead Ann catches lands on his office board + mints a customer portal link
    annNumber: '+19316324734',          // his Ann line (spells GREG) — for cost attribution
    annConnection: '3033816465695311487', // his Ann's TeXML app id
    assistantId: 'assistant-1272a268-c00e-4e5c-987a-6dded4893b4d', // Telnyx AI Assistant
    insightGroup: '9ae0abfe-78cc-424c-9713-45180b76783d', // his OWN insight group (isolated from TN's Default; webhook unset)
    planPrice: 0,                       // what we charge him/mo (0 = free trial)
  },

  // ── Jake Ihmeidan — NextGen Motors Inc., used car lot (work vans), Nashville/Antioch TN.
  //    Dealership persona: Ann = AFTER-HOURS sales lead catcher (a person answers live during
  //    open hours). PLATFORM TENANT IS STANDING (2026-08-25): company nextgen-motors (id
  //    f2de80cc-7a2b-48bb-b4ae-13e2db23fd1e, trade=dealership), board seeded with a sample
  //    vehicle-inquiry card. ⚠️ STILL NEEDS, to finish: Jake's EMAIL (login) + cell + open
  //    hours + service area confirm, then uncomment + create his Ann.
  // 'jake': {
  //   name: 'NextGen Motors',           // confirm exact spoken name
  //   type: 'dealership',
  //   ownerFirst: 'Jake',
  //   ownerCell: '+1FILL',              // where leads text (Jake's, or the lot's)
  //   area: 'Nashville and the surrounding area',
  //   hours: 'FILL_open_hours',         // when a person answers live (so Ann says when someone follows up)
  //   about: 'Used car lot specializing in work vans — cargo and passenger. We take trades and can help with financing.',
  //   platformSlug: 'nextgen-motors', annNumber: '', annConnection: '', planPrice: 0,
  // },

  // ── Brandon Pack — Music City Aquatics (Nashville), reef/aquarium tank service.
  //    Ant's best friend (the system is named after Ant). Aquarium trade is STAGED.
  //    Personal setup — the FULL platform (Ann + board + portal). PLATFORM TENANT IS
  //    STANDING (2026-08-25): company music-city-aquatics (id 433cbf40-1678-41a6-b918-
  //    187b4835429c), board seeded with a sample reef-maintenance card. ⚠️ STILL NEEDS,
  //    to finish: Brandon's EMAIL (to mint his office-board login) + his cell + hours +
  //    about block, then uncomment below + create his Ann. Strategy: docs/reef-service-moonshot.md.
  // 'music-city-aquatics': {
  //   name: 'Music City Aquatics', type: 'aquarium', ownerFirst: 'Brandon',
  //   ownerCell: '+1FILL', area: 'the Greater Nashville area', hours: 'FILL',
  //   about: 'FILL — tank setups / maintenance routes / emergency service / water testing; fresh, salt, reef; rough pricing OK to share.',
  //   platformSlug: 'music-city-aquatics', annNumber: '', annConnection: '', planPrice: 0,
  // },

  // ── Brandon Brewer — Mid Tenn Furniture (Nashville), furniture retail: delivers +
  //    custom orders. Furniture trade is STAGED (unit=order; board = order/delivery
  //    pipeline; portal = "where's my order"). PLATFORM TENANT IS STANDING (2026-08-25):
  //    company mid-tenn-furniture (id f5cfe722-f67c-4068-bbbd-3233ec2fcd38), board seeded
  //    with a sample custom-order card. ⚠️ STILL NEEDS, to finish: Brandon's EMAIL (login)
  //    + cell + hours + delivery area + about + custom-order/delivery flow, then uncomment.
  // 'mid-tenn-furniture': {
  //   name: 'Mid Tenn Furniture', type: 'furniture', ownerFirst: 'Brandon',
  //   ownerCell: '+1FILL', area: 'the Greater Nashville area', hours: 'FILL',
  //   about: 'FILL — delivery (cost/area), custom orders (lead time), financing/layaway, haul-away/trades, styles carried.',
  //   platformSlug: 'mid-tenn-furniture', annNumber: '', annConnection: '', planPrice: 0,
  // },
};

const norm = (slug) => String(slug || '').toLowerCase().trim();
function withDefaults(s) {
  return Object.assign({ type: 'appliance', autoScope: 'general', hours: 'Monday to Friday, 8 to 5', about: '', platformSlug: '', annNumber: '', annConnection: '', planPrice: 0 }, s);
}

// SYNC, file-only. Unchanged for backwards-compat (any caller that can't await).
function get(slug) {
  const s = SHOPS[norm(slug)];
  return s ? withDefaults(s) : null;
}

// ── Data-driven registry (Supabase `trial_shop`) — lets us add a shop's Ann on a call
// WITHOUT a code edit + deploy. FILE-FIRST so the hand-curated live shops (Greg, with his
// assistantId / annNumber / insightGroup) always resolve instantly and never depend on the
// store; the store is only consulted for shops that aren't in the file. On any store error
// we degrade to the file result — a store hiccup can never break an existing shop.
let sb = null;
try { sb = require('./supabase'); } catch (_) { sb = null; }

// ASYNC lookup: file first, then store. Adds `_source` so callers know whether to persist
// updates (assistant_id, number) back to the store.
async function getAsync(slug) {
  const key = norm(slug);
  const fromFile = get(key);
  if (fromFile) { fromFile._source = 'file'; return fromFile; }
  if (!sb) return null;
  try {
    // bounded so a slow store can't hang a live lead-capture call
    const rows = await Promise.race([
      sb.select('trial_shop', { select: 'config', slug: 'eq.' + key, limit: '1' }),
      new Promise((res) => setTimeout(() => res(null), 4500)),
    ]);
    if (Array.isArray(rows) && rows[0] && rows[0].config) {
      const cfg = withDefaults(rows[0].config);
      cfg._source = 'store';
      return cfg;
    }
  } catch (_) { /* degrade to null -> caller handles unknown shop */ }
  return null;
}

// Upsert a shop's config into the store, MERGING patch over any existing config (so
// create/bind can persist assistant_id / number without wiping the rest). Best-effort.
async function putStore(slug, patch) {
  if (!sb) throw new Error('store_not_configured');
  const key = norm(slug);
  let existing = {};
  try {
    const rows = await sb.select('trial_shop', { select: 'config', slug: 'eq.' + key, limit: '1' });
    if (Array.isArray(rows) && rows[0] && rows[0].config) existing = rows[0].config;
  } catch (_) {}
  const config = Object.assign({}, existing, patch || {});
  await sb.upsert('trial_shop', { slug: key, config, updated_at: new Date().toISOString() }, { onConflict: 'slug' });
  return withDefaults(config);
}

// List store-backed shops (for an admin overview). Best-effort -> [] on error.
async function listStore() {
  if (!sb) return [];
  try {
    const rows = await sb.select('trial_shop', { select: 'slug,config,updated_at', order: 'updated_at.desc', limit: '200' });
    return Array.isArray(rows) ? rows : [];
  } catch (_) { return []; }
}

module.exports = { SHOPS, get, getAsync, putStore, listStore };
