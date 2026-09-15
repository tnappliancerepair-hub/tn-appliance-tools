-- 076 · thread_message delivery receipt — "did the customer actually get it?"
--
-- Teddy, 2026-09-15: "we want to be able to see if the customers opened it or if the techs
-- have opened it."
--
-- ⚠️ BE STRAIGHT ABOUT THE CEILING: **"opened" does not exist for SMS.** No carrier reports
-- a read. The strongest true statement anyone can make about a text is that the carrier
-- accepted it and then confirmed it reached the handset. That is DELIVERED, and it is what
-- these columns hold. Nothing on this platform may ever tell a tech or a customer that a
-- text was "read" — CLAUDE.md has carried that rule since 2026-09-14 and this does not
-- change it, it just finally captures the part we DO get told.
--
-- The receipt was already arriving and we were throwing it away. Telnyx POSTs
-- message.finalized to the same messaging-profile webhook as inbound, so customer-sms-inbound
-- and human-line-inbound have been receiving one for every text we've ever sent —
-- _lib/sms-dlr recorded only the FAILURES (so sms-delivery-watch could catch a line going
-- dark) and dropped every success on the floor. There was also nothing to correlate a
-- receipt back to: a thread row carried no provider id.
--
--   provider_id     — the carrier's message id, so a receipt can find its bubble
--   delivery_status — queued | sent | delivered | failed  (never 'read' — see above)
--   delivered_at    — when the carrier confirmed the handset had it

alter table public.thread_message add column if not exists provider_id     text;
alter table public.thread_message add column if not exists delivery_status text;
alter table public.thread_message add column if not exists delivered_at    timestamptz;

-- The receipt arrives knowing only the carrier's id, so this lookup runs on every one.
-- Partial: only our outbound texts ever carry a provider id.
create index if not exists thread_provider_id_idx
  on public.thread_message (provider_id) where provider_id is not null;
