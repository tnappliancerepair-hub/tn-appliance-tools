// platform/config.js — PUBLIC config for the Ant multi-tenant platform reference apps
// (office-board, tech, portal). These run against the Supabase PLATFORM project.
//
// The anon key is DESIGNED to be public and safe in client code — Row-Level Security
// (docs/sql/004_multitenant_core.sql) is what protects every shop's data, NOT secrecy of
// this key. Fill both in from your Supabase project (Settings → API → Project URL +
// "anon public" key), commit, and the platform pages come alive.
//
// This is the reference/pilot config. In production each surface is served from the
// platform's own domain; the anon key stays the same public key.
window.ANT_SUPABASE = {
  url: '',       // e.g. https://abcdefgh.supabase.co
  anonKey: '',   // the "anon public" key (NOT the service_role key — never put that here)
};
