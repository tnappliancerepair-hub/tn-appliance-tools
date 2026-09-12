-- 070_call_lookup_service_only.sql
--
-- platform_call_lookup is the phone brain's caller resolver. It is SECURITY DEFINER on
-- purpose: it has to read a customer BEFORE anyone is signed in, so it cannot scope off
-- current_company_id() the way every other tenant function does. It takes the company as
-- an ARGUMENT instead — which means it trusts whoever calls it to name the right tenant.
--
-- That is safe from a server holding the service key. It is NOT safe from a browser: the
-- publishable key is printed in platform/config.js on every page, and the company uuid is
-- not a secret either (it is the prefix of every media object key). With those two public
-- values plus a phone number, anon could ask this function whether a given person is a
-- customer of a given shop and get their name and the state of their repair back.
--
-- Measured live 2026-09-12 before this migration: an anon caller holding only the
-- publishable key got {found:true, customer:{first_name,last_name,phone}, job:{problem,
-- status,tech_first,warranty_company,...}} for a real phone number. Direct table reads
-- were correctly empty the whole time — RLS never broke. The hole was this one grant.
--
-- CLAUDE.md already documented the intended design as "granted to service_role ONLY";
-- the grant simply drifted from the doc. Every caller in the repo
-- (platform-call-brain, platform-call-act, platform-sms-inbound, _lib/platform-thread)
-- is server-side and uses PLATFORM_SUPABASE_SERVICE_KEY, so revoking the browser roles
-- breaks nothing. Verified by grep before applying.
--
-- Idempotent: re-running is a no-op.

revoke execute on function public.platform_call_lookup(uuid, text, text, text) from anon;
revoke execute on function public.platform_call_lookup(uuid, text, text, text) from authenticated;
revoke execute on function public.platform_call_lookup(uuid, text, text, text) from public;

grant execute on function public.platform_call_lookup(uuid, text, text, text) to service_role;
