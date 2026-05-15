-- Seed data for the 2026-05-15 financial-system build.
-- Apply ONCE after the table migrations land. Idempotent (ON CONFLICT DO
-- NOTHING on the natural keys), so safe to re-run.
--
-- Apply via Xano SQL Console (Database tab) OR via the metadata API.

-- ─── warranty_vendor_accounts ───────────────────────────────────────
INSERT INTO warranty_vendor_accounts
  (company, vendor_number, state, area_description, active, vendor_number_pending, notes)
VALUES
  ('ahs', '1-822418', 'LA', 'Louisiana primary', true, false, 'AHS/Frontdoor — Louisiana account #1'),
  ('ahs', '1-822218', 'TN', 'Tennessee primary', true, false, 'AHS/Frontdoor — Tennessee account'),
  ('ahs', 'PENDING-LA-2', 'LA', 'Louisiana secondary — vendor number TBD', false, true, 'Placeholder — Teddy to fill vendor_number once confirmed'),
  ('squaretrade_servicepower', 'TNA00001', 'TN', 'SquareTrade/ServicePower primary', true, false, 'Seed; additional TNA##### IDs auto-created on first sight'),
  ('nsa', 'PENDING-NSA-1', '', 'NSA — vendor number TBD on first remittance', false, true, 'Placeholder until first NSA payment lands and parser captures the vendor number'),
  ('210', 'PENDING-210-1', '', '210 — paper check; vendor number TBD', false, true, 'Manual entry only — no email parser')
ON CONFLICT (company, vendor_number) DO NOTHING;

-- ─── technicians.commission_rate ────────────────────────────────────
-- Seeds the new column. UPDATE-only, no INSERT (techs already exist).
UPDATE technicians SET commission_rate = 0   WHERE id = 1;   -- Teddy (owner)
UPDATE technicians SET commission_rate = 45  WHERE id = 2;   -- Jimmy
UPDATE technicians SET commission_rate = 40  WHERE id = 3;   -- Andre
UPDATE technicians SET commission_rate = 50  WHERE id = 4;   -- Lee Harding
UPDATE technicians SET commission_rate = 40  WHERE id = 5;   -- Billy Savoy
UPDATE technicians SET commission_rate = 40  WHERE id = 6;   -- John Houk
