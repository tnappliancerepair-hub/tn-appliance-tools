-- 049_time_windows.sql — THREE-HOUR ARRIVAL WINDOWS (platform / Supabase).
--
-- Teddy 2026-09-08: "three separate time slots... 8 to 11, 11 to 2, 2 to 5 — two slots
-- each... that way customers aren't waiting all day over confusion."
--
-- job.time_window is OUR promise to the customer (which 3-hour block the tech arrives in).
-- It is deliberately separate from job.service_window, which is the WARRANTY COMPANY's
-- window off their dispatch ("8am-12pm", "2-6pm") — that stays exactly as it is so the
-- office can pick a slot that fits the vendor's promise instead of overwriting it.
--
-- Six stops a day per tech = 3 windows x 2 slots, which is what the office schedules into.
-- Nullable on purpose: a job can be booked to a day before the window is settled.
alter table public.job add column if not exists time_window text;
alter table public.job drop constraint if exists job_time_window_check;
alter table public.job add constraint job_time_window_check
  check (time_window is null or time_window in ('8-11','11-2','2-5'));

-- The office asks "how full is this tech's Tuesday 11-2?" on every schedule — index it.
create index if not exists job_day_window_idx on public.job (company_id, scheduled_day, time_window);

-- schedule_offer.win carries the same three windows when we offer a slot to a customer.
-- Legacy am/pm/any stay valid so offers already in flight keep working.
alter table public.schedule_offer drop constraint if exists schedule_offer_win_check;
alter table public.schedule_offer add constraint schedule_offer_win_check
  check (win in ('am','pm','any','8-11','11-2','2-5'));
