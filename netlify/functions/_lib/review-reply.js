// review-reply — shared Google-review reply generator. Same warm, varied voice
// used for the 2026-07-10 backlog catch-up, so auto-replies read consistently.
// HARD RULE: never put a personal cell in a reply. Public contact = office line.
'use strict';

const TECHS = { john: 'John', andre: 'Andre', jimmy: 'Jimmy', lee: 'Lee', teddy: 'Teddy', billy: 'Billy' };
// Order matters: more-specific terms FIRST so "dishwasher" isn't caught by "washer".
const APPL = [['refrigerator', 'refrigerator'], ['fridge', 'refrigerator'], ['freezer', 'freezer'],
  ['dishwasher', 'dishwasher'], ['washing machine', 'washer'], ['washer', 'washer'], ['washing', 'washer'],
  ['dryer', 'dryer'], ['oven', 'oven'], ['range', 'range'], ['stove', 'stove'], ['cooktop', 'cooktop'],
  ['microwave', 'microwave'], ['ice maker', 'ice maker'], ['icemaker', 'ice maker'], ['disposal', 'garbage disposal']];

function firstName(name) {
  const n = String(name || '').trim().split(/\s+/);
  return (n[0] && n[0].toLowerCase() !== 'a') ? (n[0][0].toUpperCase() + n[0].slice(1)) : 'there';
}
function detectTech(c) {
  const cl = String(c || '').toLowerCase();
  for (const k in TECHS) if (new RegExp('\\b' + k + '\\b').test(cl)) return TECHS[k];
  return null;
}
function detectAppliance(c) {
  const cl = String(c || '').toLowerCase();
  for (const [k, v] of APPL) if (cl.includes(k)) return v;
  return null;
}
// Brand, when the reviewer named it — adds honest, relevant terms to the reply.
const BRANDS = ['samsung', 'lg', 'whirlpool', 'ge', 'maytag', 'kitchenaid', 'kenmore', 'frigidaire',
  'electrolux', 'bosch', 'ge profile', 'ge cafe', 'amana', 'jenn-air', 'jennair', 'speed queen',
  'sub-zero', 'subzero', 'viking', 'thermador', 'hotpoint', 'fisher & paykel', 'fisher and paykel'];
function detectBrand(c) {
  const cl = String(c || '').toLowerCase();
  for (const b of BRANDS) if (new RegExp('\\b' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(cl)) {
    return b.split(' ').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ').replace('Ge', 'GE').replace('Lg', 'LG');
  }
  return null;
}
// The actual repair/symptom the reviewer described -> a natural "fixed" phrase.
// Only used when the review states it, so the reply stays true + specific (never invented).
const ISSUES = [
  [/not cooling|won'?t cool|stopped cooling|wasn'?t cooling/, 'cooling again'],
  [/not draining|won'?t drain|wouldn'?t drain/, 'draining properly again'],
  [/not spinning|won'?t spin/, 'spinning again'],
  [/not heating|won'?t heat|no heat|stopped heating/, 'heating again'],
  [/ice ?maker/, 'ice maker working again'],
  [/leak/, 'leak sorted out'],
  [/won'?t start|not turning on|wouldn'?t turn on/, 'up and running again'],
  [/not making ice|no ice/, 'making ice again'],
  [/making noise|loud|noisy/, 'running quietly again'],
  [/not drying|won'?t dry|wasn'?t drying/, 'drying again'],
];
function detectIssue(c) {
  const cl = String(c || '').toLowerCase();
  for (const [re, phrase] of ISSUES) if (re.test(cl)) return phrase;
  return null;
}

// Warm, personalized thank-you for a 4-5 star review. idx varies the wording. Weaves
// in the SPECIFIC appliance + brand + the actual repair when the review reveals them
// (relevant, honest terms that also help us rank), staying human — never stuffed.
function positiveReply(review, idx) {
  idx = idx || 0;
  const fn = firstName(review.reviewer);
  const c = review.comment || '';
  const tech = detectTech(c), appl = detectAppliance(c), brand = detectBrand(c), issue = detectIssue(c);
  const op = [`Thank you so much, ${fn}!`, `We really appreciate this, ${fn}.`, `Thanks a ton, ${fn}!`,
    `This made our day, ${fn} — thank you.`, `Appreciate you taking the time, ${fn}.`][idx % 5];
  // Build the specific "what we fixed" phrase from whatever the review actually mentions.
  const unit = [brand, appl].filter(Boolean).join(' ');            // "Samsung refrigerator" / "refrigerator" / ""
  const who = tech ? `${tech}` : 'our team';
  const whoPride = tech ? `${tech} takes real pride in his work` : 'Our team takes real pride in the work';
  let repair = '';
  if (unit && issue) {
    // Avoid doubling the appliance noun (e.g. "ice maker" appliance + "ice maker working again").
    repair = (appl && issue.toLowerCase().includes(appl.toLowerCase()))
      ? `got your ${[brand, issue].filter(Boolean).join(' ')}`
      : `got your ${unit} ${issue}`;
  } else if (unit) repair = `got your ${unit} taken care of`;
  else if (issue) repair = `got it ${issue}`;
  let mid;
  if (repair) mid = ` ${whoPride}, and we're glad ${who} ${repair}.`;
  else if (tech) mid = ` ${whoPride}, and we'll be sure he hears this.`;
  else mid = ' So glad we could take care of you.';
  const cl = [' Thanks for trusting us with your appliance repair — we\'re here whenever you need us.',
    ' We\'re grateful for your business and here anytime you need appliance repair again.',
    ' It means a lot. Don\'t hesitate to call us if anything else comes up.',
    ' Thank you for the kind words — we\'ve got your back for any future repairs.',
    ' We appreciate you and look forward to helping again if you ever need us.'][idx % 5];
  return op + mid + cl + ' — The TN Appliance Exchange team';
}

// Calm, accountable draft for a 1-3 star review. NEVER auto-posted — for a human.
// Office line only, never a personal cell.
function negativeReply(review) {
  const fn = firstName(review.reviewer);
  return (`${fn}, we're sorry — we hear you. We're working hard to get better, and we'll learn `
    + `and improve from this. If you'll give us the chance to make it right, please reach our `
    + `office at 866-268-0111. — The TN Appliance Exchange team`);
}

module.exports = { positiveReply, negativeReply, firstName, detectTech, detectAppliance, detectBrand, detectIssue };
