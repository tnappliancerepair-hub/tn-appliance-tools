-- 065_part_pickup_receipt.sql — the part the tech went and BOUGHT, and the receipt that proves it.
--
-- Teddy 2026-09-11: "take a pic of the part that you picked up at the parts house or thing at
-- Home Depot or wherever [and a] pic of the receipt 🧾"
--
-- Why this is the money half of the parts loop: a warranty part is supplied by the vendor and
-- costs us nothing. A part a tech goes and BUYS is the one case where the shop is out real cash,
-- and today the only record of that is a paper receipt in a truck. That receipt is:
--   * the COST that drives the customer's price (cost x the owner's margin)
--   * the tech's reimbursement if he paid out of pocket
--   * the line the books need at tax time
-- Snapping it at the counter means nobody re-keys a price and nobody loses a receipt.
alter table job_part add column if not exists receipt_ref text;   -- R2 key of the receipt photo
alter table job_part add column if not exists bought_at   timestamptz;
alter table job_part add column if not exists bought_by   text;   -- the tech who picked it up
-- What the receipt said, kept verbatim next to the parsed cost so a wrong read is auditable
-- rather than silently trusted.
alter table job_part add column if not exists bought_from text;   -- store as read off the receipt

comment on column job_part.receipt_ref is
  'Photo of the purchase receipt. cost_cents is read FROM this -- keep both so a bad OCR can be checked against the paper.';

-- "What did we buy this week and did it get billed" — the office/books question.
create index if not exists job_part_bought_idx
  on job_part (company_id, bought_at desc) where bought_at is not null;
