-- 060_reminder_once.sql — APPLIED 2026-09-10
--
-- The day-before reminder deduped with read-marker -> send -> write-marker, so two
-- concurrent runs both passed the check and both texted the customer. Measured on
-- 2026-09-07: 42 markers across 25 jobs = 17 customers got the reminder TWICE.
-- Every other day was a clean 1:1.
--
-- platform-appt-reminder now CLAIMS BEFORE SENDING. This index is what makes that
-- airtight: the losing run's insert is refused by the database, so it never sends.
-- Failure direction becomes a missed reminder (silent, recoverable) rather than a
-- double text.
--
-- Duplicates were cleaned first (keep oldest per job) or the index cannot build.
create unique index if not exists thread_reminder_once_uidx
  on thread_message (job_id) where channel = 'reminder';
