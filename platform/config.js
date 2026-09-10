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

// (The ANT_SETUP_BYPASS demo auto-login flag lived here. It and setup-bypass.js were removed on
// 2026-09-10 — real customers sign in on these seats now, and that shim signed ANY non-demo
// session out and into the demo tenant. Demo work uses the demo login like anyone else.)
