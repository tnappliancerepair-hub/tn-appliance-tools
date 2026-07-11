// review-reply — shared Google-review reply generator. Same warm, varied voice
// used for the 2026-07-10 backlog catch-up, so auto-replies read consistently.
// HARD RULE: never put a personal cell in a reply. Public contact = office line.
'use strict';

const TECHS = { john: 'John', andre: 'Andre', jimmy: 'Jimmy', lee: 'Lee', teddy: 'Teddy', billy: 'Billy' };
const APPL = [['refrigerator', 'fridge'], ['fridge', 'fridge'], ['freezer', 'freezer'], ['dryer', 'dryer'],
  ['washer', 'washer'], ['washing', 'washer'], ['dishwasher', 'dishwasher'], ['oven', 'oven'],
  ['range', 'range'], ['stove', 'stove'], ['ice maker', 'ice maker'], ['icemaker', 'ice maker']];

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

// Warm, personalized thank-you for a 4-5 star review. idx varies the wording.
function positiveReply(review, idx) {
  idx = idx || 0;
  const fn = firstName(review.reviewer);
  const c = review.comment || '';
  const tech = detectTech(c), appl = detectAppliance(c);
  const op = [`Thank you so much, ${fn}!`, `We really appreciate this, ${fn}.`, `Thanks a ton, ${fn}!`,
    `This made our day, ${fn} — thank you.`, `Appreciate you taking the time, ${fn}.`][idx % 5];
  let mid;
  if (tech && appl) mid = ` ${tech} takes real pride in his work, and we're glad he got your ${appl} taken care of.`;
  else if (tech) mid = ` ${tech} takes real pride in his work, and we'll be sure he hears this.`;
  else if (appl) mid = ` So glad we could get your ${appl} running right again.`;
  else mid = ' So glad we could take care of you.';
  const cl = [' Thanks for trusting us — we\'re here whenever you need us.',
    ' We\'re grateful for your business and here anytime you need us again.',
    ' It means a lot. Don\'t hesitate to call us if anything else comes up.',
    ' Thank you for the kind words — we\'ve got your back going forward.',
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

module.exports = { positiveReply, negativeReply, firstName, detectTech, detectAppliance };
