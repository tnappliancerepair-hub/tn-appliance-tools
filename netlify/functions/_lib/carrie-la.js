// carrie-la — Carrie is the LOUISIANA office contact (Baton Rouge, 225 line).
// Teddy 2026-08-22: "only send texts to Carrie if it has to do with Louisiana."
// This decides "is this Louisiana?" from whatever a caller has on hand — the
// assigned tech (Andre id 3 = South Shore, John id 6 = North Shore/Baton Rouge
// are the LA techs) or the job's state. Used to gate every text to Carrie.
'use strict';
const LA_TECHS = new Set([3, 6]);              // Andre, John — the Louisiana crew
const CARRIE_DEFAULT = '+12258035669';         // Carrie's cell (OFFICE_CELL_CARRIE overrides)
const CARRIE_EMAIL_DEFAULT = 'mapes96@msn.com'; // Carrie's email (OFFICE_EMAIL_CARRIE overrides)

function isLouisiana(ctx) {
  const c = ctx || {};
  if (LA_TECHS.has(Number(c.techId))) return true;
  if (/^(la|louisiana)$/i.test(String(c.state || '').trim())) return true;
  return false;
}

module.exports = { isLouisiana, LA_TECHS, CARRIE_DEFAULT, CARRIE_EMAIL_DEFAULT };
