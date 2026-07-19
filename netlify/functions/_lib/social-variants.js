// Turn ONE campaign post into ready-to-paste copy for every surface.
// Facebook is the source (already written well). Instagram / X / TikTok / YouTube
// are derived so the drafts page becomes "write once, post everywhere."
//
// No clickable links on IG/TikTok captions (they don't linkify) — we lean on the
// phone/text CTA. X gets a tight <=280 version. YouTube gets a title + description.
'use strict';

const PHONE = '615-280-2949';
const SITE = 'tnapplianceexchange.net';

// Hashtag pools — appended to the surfaces where tags actually drive reach.
const TAGS = {
  core: ['#appliancerepair', '#familyowned', '#supportlocal'],
  local: ['#NashvilleTN', '#MurfreesboroTN', '#MiddleTennessee', '#SmyrnaTN'],
  brand: ['#AntAppliance', '#TNAppliance'],
  dryer: ['#dryerrepair', '#dryerventcleaning', '#homesafety'],
  ai: ['#AI', '#smallbusiness', '#24hours'],
};

function tagsFor(key) {
  const out = [...TAGS.brand, ...TAGS.core];
  if (/dryer|safety|gas/.test(key)) out.push(...TAGS.dryer);
  if (/robot|ai|demo|helper|movement/.test(key)) out.push(...TAGS.ai);
  out.push(...TAGS.local.slice(0, 3));
  // de-dupe, cap so it doesn't look spammy
  return [...new Set(out)].slice(0, 10);
}

function firstParagraph(msg) {
  const blocks = String(msg || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return blocks[0] || String(msg || '').trim();
}

// Tight version for X (<=280 incl. the CTA).
function forX(item) {
  let lead = firstParagraph(item.message).replace(/\s+/g, ' ').trim();
  const cta = ` 📞 ${PHONE}`;
  const budget = 279 - cta.length;
  if (lead.length > budget) lead = lead.slice(0, budget - 1).replace(/\s+\S*$/, '') + '…';
  return lead + cta;
}

function forInstagram(item) {
  const tags = tagsFor(item.key).join(' ');
  const cta = `📞 Text or call ${PHONE} — Ann answers 24/7 🐜`;
  return `${item.message.trim()}\n\n${cta}\n.\n.\n${tags}`;
}

function forTikTok(item) {
  const tags = tagsFor(item.key).slice(0, 6).join(' ');
  const lead = firstParagraph(item.message).replace(/\s+/g, ' ').trim();
  return `${lead} 🐜\n\n${tags}`;
}

// Truth Social allows longer posts than X — give it the full message + CTA.
function forTruthSocial(item) {
  const tags = tagsFor(item.key).slice(0, 4).join(' ');
  return `${item.message.trim()}\n\n📞 ${PHONE} — Ann answers 24/7 🐜\n\n${tags}`;
}

function forYouTube(item) {
  // Title from the human title, stripped of internal notes/view-counts.
  let title = String(item.title || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')       // drop "(9,275 views)" etc.
    .replace(/\s*[→·—-].*$/, '')            // drop trailing internal descriptors
    .replace(/\s+/g, ' ').trim();
  if (!title) title = 'TN Appliance';
  if (title.length > 90) title = title.slice(0, 89).replace(/\s+\S*$/, '') + '…';
  title = `${title} | TN Appliance 🐜`;
  const tags = tagsFor(item.key).join(' ');
  const description = `${item.message.trim()}\n\n📞 Text or call ${PHONE} — our AI, Ann, answers 24/7.\n🌐 ${SITE}\nFamily-owned in Middle Tennessee & South Louisiana since 2012.\n\n${tags}`;
  return { title, description };
}

// Returns the per-platform copy for one PLAN item.
function variantsFor(item) {
  if (!item) return null;
  return {
    facebook: { label: 'Facebook', text: item.message, link: item.link || null, note: item.link ? 'Attach the video, then paste this caption.' : null },
    instagram: { label: 'Instagram', text: forInstagram(item), note: item.kind === 'video' ? 'Post as a Reel; no clickable links in caption.' : 'Pair with an image or your logo.' },
    x: { label: 'X / Twitter', text: forX(item), note: 'Trimmed to fit. Add the video/photo natively.' },
    truthsocial: { label: 'Truth Social', text: forTruthSocial(item), note: 'Paste + attach the video/photo. (No open posting API — manual.)' },
    tiktok: { label: 'TikTok', text: forTikTok(item), note: item.kind === 'video' ? 'Upload the clip; keep it snappy.' : 'Turn into a quick talking-head or text-on-screen clip.' },
    youtube: forYouTube(item), // { title, description }
  };
}

module.exports = { variantsFor, PHONE, SITE };
