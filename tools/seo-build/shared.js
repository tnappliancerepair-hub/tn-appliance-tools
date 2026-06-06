// Shared constants used across all generated pages.

const SITE = "https://tnapplianceexchange.net";
const PHONE_TN = "866-268-0111";
const PHONE_LA = "504-355-9111";

const CITIES_TN = [
  { name: "Nashville", slug: "nashville", phone: PHONE_TN },
  { name: "Murfreesboro", slug: "murfreesboro", phone: PHONE_TN },
  { name: "Antioch", slug: "antioch", phone: PHONE_TN },
  { name: "Clarksville", slug: "clarksville", phone: PHONE_TN },
  { name: "Brentwood", slug: "brentwood", phone: PHONE_TN },
  { name: "Franklin", slug: "franklin", phone: PHONE_TN },
  { name: "Hermitage", slug: "hermitage", phone: PHONE_TN },
  { name: "Hendersonville", slug: "hendersonville", phone: PHONE_TN },
  { name: "Gallatin", slug: "gallatin", phone: PHONE_TN },
  { name: "Smyrna", slug: "smyrna", phone: PHONE_TN },
  { name: "La Vergne", slug: "la-vergne", phone: PHONE_TN },
  { name: "Lebanon", slug: "lebanon", phone: PHONE_TN },
  { name: "Mt. Juliet", slug: "mt-juliet", phone: PHONE_TN },
  { name: "Nolensville", slug: "nolensville", phone: PHONE_TN },
  { name: "Spring Hill", slug: "spring-hill", phone: PHONE_TN },
  { name: "Ashland City", slug: "ashland-city", phone: PHONE_TN },
  { name: "Kingston Springs", slug: "kingston-springs", phone: PHONE_TN },
  { name: "Pleasant View", slug: "pleasant-view", phone: PHONE_TN }
];

const CITIES_LA = [
  { name: "New Orleans", slug: "new-orleans", phone: PHONE_LA },
  { name: "Baton Rouge", slug: "baton-rouge", phone: PHONE_LA },
  { name: "Hammond", slug: "hammond", phone: PHONE_LA },
  { name: "Metairie", slug: "metairie", phone: PHONE_LA },
  { name: "Kenner", slug: "kenner", phone: PHONE_LA },
  { name: "Chalmette", slug: "chalmette", phone: PHONE_LA },
  { name: "Slidell", slug: "slidell", phone: PHONE_LA },
  { name: "Mandeville", slug: "mandeville", phone: PHONE_LA },
  { name: "Covington", slug: "covington", phone: PHONE_LA },
  { name: "Walker", slug: "walker", phone: PHONE_LA },
  { name: "Denham Springs", slug: "denham-springs", phone: PHONE_LA },
  { name: "Gonzales", slug: "gonzales", phone: PHONE_LA },
  { name: "Prairieville", slug: "prairieville", phone: PHONE_LA },
  { name: "Madisonville", slug: "madisonville", phone: PHONE_LA },
  { name: "Ponchatoula", slug: "ponchatoula", phone: PHONE_LA },
  { name: "Abita Springs", slug: "abita-springs", phone: PHONE_LA },
  { name: "Pearl River", slug: "pearl-river", phone: PHONE_LA },
  { name: "Laplace", slug: "laplace", phone: PHONE_LA },
  { name: "Pumpkin Center", slug: "pumpkin-center", phone: PHONE_LA }
];

const ALL_CITIES = [...CITIES_TN, ...CITIES_LA];

// Encode HTML-safe text for JSON-LD strings.
function jsonStr(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

// Encode HTML attribute / content text.
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

module.exports = { SITE, PHONE_TN, PHONE_LA, CITIES_TN, CITIES_LA, ALL_CITIES, jsonStr, esc };
