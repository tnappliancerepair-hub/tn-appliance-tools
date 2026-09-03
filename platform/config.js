// platform/config.js — PUBLIC config for the Ant multi-tenant platform reference apps
// (office-board, tech, portal). These run against the Supabase PLATFORM project.
//
// Both values below are PUBLIC and safe in client code. The publishable key
// (sb_publishable_…, formerly the "anon" key) is browser-safe by design — Row-Level
// Security (docs/sql/004_multitenant_core.sql) is what protects every shop's data,
// NOT secrecy of this key. NEVER put the secret key (sb_secret_…) here.
//
// Project: "ANT Platforms" (Supabase), separate from the ANT OPS archive project.
window.ANT_SUPABASE = {
  url: 'https://tntbhfwitytkcoqlejwc.supabase.co',
  anonKey: 'sb_publishable_gtcSGgZWhqkrUxdPxFhKrA_CwUBcyq7',
};

// Demo auto-login is OFF — real customers are signing up now (customer #1 = TN Appliance Exchange).
// setup-bypass.js is fully inert while this is false, so every office/tech seat respects the real
// signed-in login (leaving it true CLOBBERED a real owner's session back into the demo tenant).
// To temporarily re-open the no-login demo again for internal board work, flip back to true — but
// NEVER while real customers are onboarding.
window.ANT_SETUP_BYPASS = false;
