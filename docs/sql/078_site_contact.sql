-- 078 — a SECOND person to call on a job (the one who is actually at the door)
--
-- A tech, 2026-09-17: "Is there any way to add a tenant to a order so I can call them
-- ahead of time to see if parts arrived."
--
-- He is right and there was nowhere to put it. The platform carries exactly ONE phone per
-- customer. On a rental the account is the landlord or the property manager; the person
-- who signs for the part and opens the door is the TENANT. On a warranty claim the account
-- can be the homeowner's spouse. Measured on TN's own board before building this: 11 jobs
-- ever have a second phone written into free text (access_notes / office_notes /
-- availability) and 6 of those 11 are a DIFFERENT number than the one on file --
-- "send same message to my wife Carmen @985-788-2174", "281-907-3113: if number on file
-- doesn't work". Small, and every one of them is a truck roll riding on a call the tech
-- cannot place from the app.
--
-- Deliberately TWO plain columns, not a second customer row and not an enum:
--   * a second customer row would double-count the customer everywhere that counts people
--     (dedup, lead attribution, the messages inbox) to solve a phone-number problem.
--   * the name field carries the relationship in the office's own words -- "Carmen (wife)",
--     "tenant - Maria", "property manager". An enum would just be a list we get wrong.
--
-- This is a NUMBER TO CALL, not a messaging identity. Nothing automated may ever text it:
-- we have no consent from this person and they are not the account holder. The tech taps it
-- and dials, and that is the whole feature.
alter table job add column if not exists site_contact_name  text;
alter table job add column if not exists site_contact_phone text;

comment on column job.site_contact_name  is 'Who else is at the door -- tenant, spouse, property manager. Free text, the office''s own words.';
comment on column job.site_contact_phone is 'A number the TECH dials. Never auto-texted: no consent, not the account holder.';

-- New columns on job inherit job''s existing tenant RLS policy; nothing to add.
