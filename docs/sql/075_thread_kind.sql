-- 075 · thread_message.kind — tell a MESSAGE apart from a NOTE.
--
-- Danielle, 2026-09-15: something is wrong with the text messages. Measured on the live
-- board before writing a line — every inbound row, by channel:
--
--     in · portal   1004   ← "✍️ Release of liability signed by X", "✅ Finished intake"
--     in · sms       239   ← the ONLY real inbound texts
--     in · email      39   ← Frontdoor/AHS dispatch emails
--     in · call       10   ← "📅 Requested Friday, Sep 4 (by phone)"
--     in · lsa         2   ← a pasted Google LSA lead transcript
--
-- So 81% of what lands on her INBOUND side is a line a function composed, and every one of
-- them renders as a blue CUSTOMER bubble. Worse: the inbox decides "← they replied" purely
-- on whether the last row is inbound, so 39 of the 85 conversations it flags as needing her
-- are a warranty dispatch email. Nobody is waiting on a reply to a dispatch email. A third
-- of her to-do list is noise, and it buries the 56 people who genuinely are waiting.
--
-- The fix is to stop inferring. A row now says what it is:
--   'message' — a human actually said this. Customer, office, tech, or Ann.
--   'note'    — the system recorded that something happened. Nobody spoke.
--
-- A note never reads as "the customer replied", never lights the unread dot, and renders as
-- a quiet centered line instead of speech.

alter table public.thread_message
  add column if not exists kind text not null default 'message';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'thread_message_kind_check') then
    alter table public.thread_message
      add constraint thread_message_kind_check check (kind in ('message','note'));
  end if;
end $$;

-- The inbox asks "who spoke last, and was it a real person" on every load.
create index if not exists thread_kind_company_created_idx
  on public.thread_message (company_id, kind, created_at desc);

-- ── BACKFILL — INBOUND ONLY, and deliberately so ────────────────────────────────────
-- Every inbound row that is not an SMS was composed by one of our own functions: the
-- waiver signature, the intake-finished note, the mirrored dispatch email, the day a
-- caller asked for by phone, the pasted LSA transcript. None of them is the customer
-- speaking, and the channel each was filed under is the durable record of that.
--
-- The OUTBOUND side is left completely alone. Some out rows are the real text we sent and
-- some are a log line about having sent one, and they are not cleanly separable from the
-- channel — so the safe direction is to leave them showing. An extra line on our own half
-- of the thread costs a scroll; wrongly hiding something we told a customer costs the job.
update public.thread_message
   set kind = 'note'
 where kind <> 'note'
   and direction = 'in'
   and channel in ('portal','email','call','lsa');
