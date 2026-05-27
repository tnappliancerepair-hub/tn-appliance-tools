#!/usr/bin/env node
// Round 4 blueprint expansion. Populates the 2 remaining empty colonies:
// Andre Personal Brand + Story and Why. These need a content-generation
// template (operator todo to add). Specs landed so the architect has
// something to pick up once that template exists.

import fs from 'node:fs';

const BP_PATH = 'docs/appliance-ant-master-blueprint.json';
const bp = JSON.parse(fs.readFileSync(BP_PATH, 'utf8'));

function maxNumericSuffix(ids, prefix) {
  let max = 0;
  for (const id of ids) {
    const m = String(id || '').match(new RegExp('^' + prefix + '(\\d+)$'));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function colonyIndexByName(name) {
  return bp.colonies.findIndex((c) => c.name === name);
}

function addAgents(colonyIndex, prefix, padDigits, newAgents) {
  const col = bp.colonies[colonyIndex];
  if (!col) throw new Error(`colony ${colonyIndex} not found`);
  if (!Array.isArray(col.agents)) col.agents = [];
  let nextNum = maxNumericSuffix(col.agents.map((a) => a.id), prefix);
  const pad = (n) => String(n).padStart(padDigits, '0');
  const inserted = [];
  for (const a of newAgents) {
    nextNum += 1;
    const id = `${prefix}${pad(nextNum)}`;
    col.agents.push({
      id,
      name: a.name,
      status: 'TO_BUILD',
      priority: a.priority || 3,
      purpose: a.purpose,
      triggers: a.triggers || [],
      outputs: a.outputs || [],
      xano_endpoint: a.xano_endpoint || (a.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
      dependencies: a.dependencies || [],
    });
    inserted.push(id);
  }
  col.agents_total = col.agents.length;
  console.log(`[colony ${colonyIndex} ${col.name}] +${inserted.length}: ${inserted[0]}..${inserted[inserted.length - 1]}`);
  return inserted;
}

// Andre Personal Brand (AB prefix) — 8 specs for content_generator template
const andreAgents = [
  { name: 'Andre Weekly Story Writer', purpose: 'Generates a weekly LinkedIn/blog post about Andre\'s tech work in Hammond LA. Listens for CONTENT_GENERATOR_REQUEST_ANDRE_WEEKLY_STORY.' },
  { name: 'Andre LinkedIn Headline Refresher', purpose: 'Suggests fresh LinkedIn headlines monthly for Andre. Listens for CONTENT_GENERATOR_REQUEST_ANDRE_LINKEDIN_HEADLINE.' },
  { name: 'Andre Case Study Generator', purpose: 'Picks a high-complexity recent job + writes a case study post for Andre. Listens for CONTENT_GENERATOR_REQUEST_ANDRE_CASE_STUDY.' },
  { name: 'Andre Tech Tip Snippet', purpose: 'Generates short tech-tip social posts in Andre\'s voice. Listens for CONTENT_GENERATOR_REQUEST_ANDRE_TECH_TIP.' },
  { name: 'Andre Customer Testimonial Curator', purpose: 'Pulls Andre-job feedback rated 5 + drafts a testimonial post. Listens for CONTENT_GENERATOR_REQUEST_ANDRE_TESTIMONIAL.' },
  { name: 'Andre Local Network Outreach', purpose: 'Drafts outreach messages to Hammond/Walker local FB groups + Nextdoor. Listens for CONTENT_GENERATOR_REQUEST_ANDRE_LOCAL_OUTREACH.' },
  { name: 'Andre Year-In-Review', purpose: 'End-of-year recap of Andre\'s jobs + wins. Listens for CONTENT_GENERATOR_REQUEST_ANDRE_YEAR_REVIEW.' },
  { name: 'Andre Branded Cross-Post Rewriter', purpose: 'Rewrites a TN-Appliance post in Andre\'s personal voice. Listens for CONTENT_GENERATOR_REQUEST_ANDRE_CROSS_POST.' },
];

// Story and Why (SW prefix) — 8 specs
const storyAgents = [
  { name: 'Origin Story Refresher', purpose: 'Quarterly rewrite of the TN Appliance origin story for SEO + social. Listens for CONTENT_GENERATOR_REQUEST_ORIGIN_STORY_REFRESH.' },
  { name: 'Why We Built Ant Post', purpose: 'Generates posts explaining the Ant platform story for prospective customers + new hires. Listens for CONTENT_GENERATOR_REQUEST_WHY_ANT_POST.' },
  { name: 'Founder Voice Manifesto', purpose: 'Drafts Teddy-voiced manifesto posts on appliance repair values + ethics. Listens for CONTENT_GENERATOR_REQUEST_FOUNDER_MANIFESTO.' },
  { name: 'Customer Save Stories', purpose: 'Pulls jobs where we saved a customer significant money + writes the story. Listens for CONTENT_GENERATOR_REQUEST_SAVE_STORY.' },
  { name: 'Tech Hero Spotlight', purpose: 'Monthly spotlight post on a tech\'s standout job. Listens for CONTENT_GENERATOR_REQUEST_TECH_HERO_SPOTLIGHT.' },
  { name: 'Community Impact Recap', purpose: 'Quarterly recap of community work + sponsorships. Listens for CONTENT_GENERATOR_REQUEST_COMMUNITY_IMPACT.' },
  { name: 'Industry Trend Commentary', purpose: 'Generates Teddy-voice commentary on industry news (new appliance models, regulations, etc). Listens for CONTENT_GENERATOR_REQUEST_INDUSTRY_TREND.' },
  { name: 'Recruitment Story Post', purpose: 'Drafts recruitment-narrative posts that double as employer-brand content. Listens for CONTENT_GENERATOR_REQUEST_RECRUITMENT_STORY.' },
];

const andreIdx = colonyIndexByName('Andre Personal Brand Colony');
const storyIdx = colonyIndexByName('Story and Why Colony');

if (andreIdx >= 0) addAgents(andreIdx, 'AB', 3, andreAgents);
if (storyIdx >= 0) addAgents(storyIdx, 'SW', 3, storyAgents);

bp.meta = bp.meta || {};
bp.meta.agents_total = bp.colonies.reduce((a, c) => a + (c.agents || []).length, 0);
bp.meta.agents_to_build = bp.colonies.reduce((a, c) => a + (c.agents || []).filter(x => x.status === 'TO_BUILD').length, 0);
bp.meta.agents_built = bp.colonies.reduce((a, c) => a + (c.agents || []).filter(x => x.status === 'BUILT').length, 0);
bp.meta.agents_live = bp.colonies.reduce((a, c) => a + (c.agents || []).filter(x => x.status === 'LIVE').length, 0);

fs.writeFileSync(BP_PATH, JSON.stringify(bp, null, 2));
console.log('\nblueprint totals:', bp.meta.agents_total, 'agents,', bp.meta.agents_to_build, 'to_build');
