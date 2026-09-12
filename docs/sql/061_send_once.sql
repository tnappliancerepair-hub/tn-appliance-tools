-- 061_send_once.sql — make a double-text structurally impossible, for every send.
--
-- WHY (measured 2026-09-10): the day-before reminder texted 17 customers TWICE on 09-07.
-- The dedupe was read-marker -> SEND -> write-marker, which is correct for sequential runs
-- and useless for concurrent ones: two runs both read "not sent yet" and both text. The race
-- window was the entire SMS round trip. Fixing that one caller is not the fix -- the same
-- shape lives in the review sweep (two writers: the cron AND the manual star button), and in
-- every arrived/complete/on-my-way tap that can be double-pressed.
--
-- So the guard moves into the DATABASE, once, for all of them: a send declares a KEY before
-- it sends, and the database refuses the second claim. The loser never texts.
--
--   once ever, per job:  'review:<job_id>'          'reminder:<job_id>'
--   once per day:        'arrived:<job_id>:<date>'  'otw:<job_id>:<date>'
--
-- One column + one index covers every present and future send. A send with no key behaves
-- exactly as before (free-form office/tech messages are SUPPOSED to repeat), so this is
-- additive: nothing that legitimately repeats is constrained.
--
-- Scoped by company_id so tenants can never collide, even on a malformed key.

alter table thread_message add column if not exists send_key text;

create unique index if not exists thread_send_once_uidx
  on thread_message (company_id, send_key)
  where send_key is not null;

comment on column thread_message.send_key is
  'Claim key for once-only sends. Insert the row BEFORE texting; if the insert is refused, another run already owns this send -- do not text. NULL = a message that may repeat (free-form office/tech replies).';
