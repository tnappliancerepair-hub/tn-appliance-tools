#!/usr/bin/env node
// Round 3 blueprint expansion. Populates 3 of the 5 empty colonies:
// Office Efficiency, Marketing/SEO, Customer Acquisition. Specs match
// existing architect templates so they build on the next architect
// run without new template work.

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
      priority: a.priority || 2,
      purpose: a.purpose,
      triggers: a.triggers || [],
      outputs: a.outputs || [],
      xano_endpoint:
        a.xano_endpoint ||
        (a.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
      dependencies: a.dependencies || [],
    });
    inserted.push(id);
  }
  col.agents_total = col.agents.length;
  console.log(`[colony ${colonyIndex} ${col.name}] +${inserted.length}: ${inserted[0]}..${inserted[inserted.length - 1]}`);
  return inserted;
}

// ── Office Efficiency (OF prefix) — 12 specs matching scheduling_optimizer
const officeAgents = [
  { name: 'AHS Backlog Aging Reporter', purpose: 'Surfaces AHS jobs aging in not_ready status >7 days. Listens for SCHEDULE_REQUEST_AHS_BACKLOG_AGING.' },
  { name: 'Daily Office Health Scorer', purpose: 'Composes daily 8am office health score from scheduled/in-progress/completed counts. Listens for SCHEDULE_REQUEST_DAILY_OFFICE_HEALTH.' },
  { name: 'Office Touchpoint Audit', purpose: 'Counts office-driven SMS / actions per day per staff member. Listens for SCHEDULE_REQUEST_OFFICE_TOUCHPOINT_AUDIT.' },
  { name: 'Reschedule Pattern Analyzer', purpose: 'Identifies customers / tech-pairs with disproportionate reschedule rates. Listens for SCHEDULE_REQUEST_RESCHEDULE_PATTERN_ANALYZER.' },
  { name: 'Calendar Conflict Detector', purpose: 'Flags overlapping appointments per tech in the week ahead. Listens for SCHEDULE_REQUEST_CALENDAR_CONFLICT_DETECTOR.' },
  { name: 'Office Shift Coverage Watcher', purpose: 'Watches that office staff have coverage on the calendar. Listens for SCHEDULE_REQUEST_OFFICE_SHIFT_COVERAGE.' },
  { name: 'New Customer Welcome Coordinator', purpose: 'Confirms first-time customers get the welcome SMS + chat link. Listens for SCHEDULE_REQUEST_NEW_CUSTOMER_WELCOME.' },
  { name: 'Repeat Customer Recognition', purpose: 'Detects known-customer inbound + recommends greeting tweak. Listens for SCHEDULE_REQUEST_REPEAT_CUSTOMER_RECOGNITION.' },
  { name: 'AHS Manual Backfill Helper', purpose: 'Suggests a small batch of AHS not_ready jobs to backfill into scheduling_queue per office click. Listens for SCHEDULE_REQUEST_AHS_MANUAL_BACKFILL.' },
  { name: 'After-Hours Voicemail Followup', purpose: 'Detects voicemails left after-hours + queues a morning callback. Listens for SCHEDULE_REQUEST_AFTER_HOURS_VOICEMAIL_FOLLOWUP.' },
  { name: 'Stuck Job Watcher', purpose: 'Identifies jobs sitting in same status >5 days with no events. Listens for SCHEDULE_REQUEST_STUCK_JOB_WATCHER.' },
  { name: 'Office Inbox Hygiene Scorer', purpose: 'Scores office email/SMS reply latency. Listens for SCHEDULE_REQUEST_OFFICE_INBOX_HYGIENE.' },
];

// ── Marketing / SEO (M prefix) — 10 specs matching market_intelligence
const marketingAgents = [
  { name: 'GMB Profile Watcher', purpose: 'Watches Google My Business reviews + photos + Q&A across our regional listings. Listens for MARKET_INTELLIGENCE_REQUEST_GMB_PROFILE_WATCHER.' },
  { name: 'SEO Keyword Tracker', purpose: 'Tracks our ranking on key local SEO terms (e.g. "appliance repair Nashville"). Listens for MARKET_INTELLIGENCE_REQUEST_SEO_KEYWORD_TRACKER.' },
  { name: 'Competitor Pricing Watcher', purpose: 'Monitors competitor diagnostic + service-call fees in our regions. Listens for MARKET_INTELLIGENCE_REQUEST_COMPETITOR_PRICING.' },
  { name: 'Yelp Review Watcher', purpose: 'Watches Yelp reviews for our brand + competitor brands. Listens for MARKET_INTELLIGENCE_REQUEST_YELP_REVIEW_WATCHER.' },
  { name: 'Facebook Marketplace Lead Scout', purpose: 'Scouts FB Marketplace for repair-help posts in our service zones. Listens for MARKET_INTELLIGENCE_REQUEST_FB_MARKETPLACE_LEAD_SCOUT.' },
  { name: 'Nextdoor Recommendation Watcher', purpose: 'Watches Nextdoor neighborhood feeds for recommendation requests. Listens for MARKET_INTELLIGENCE_REQUEST_NEXTDOOR_RECOMMENDATION_WATCHER.' },
  { name: 'Service Page SEO Audit', purpose: 'Audits our service-area landing pages for SEO health. Listens for MARKET_INTELLIGENCE_REQUEST_SERVICE_PAGE_SEO_AUDIT.' },
  { name: 'Backlink Profile Watcher', purpose: 'Tracks new backlinks to tnapplianceexchange.net. Listens for MARKET_INTELLIGENCE_REQUEST_BACKLINK_PROFILE_WATCHER.' },
  { name: 'Local Pack Visibility Scorer', purpose: 'Scores how often we show in the local-pack 3-pack for key search terms. Listens for MARKET_INTELLIGENCE_REQUEST_LOCAL_PACK_VISIBILITY.' },
  { name: 'Brand Mention Watcher', purpose: 'Tracks brand mentions of "TN Appliance" across the web. Listens for MARKET_INTELLIGENCE_REQUEST_BRAND_MENTION_WATCHER.' },
];

// ── Customer Acquisition (CA prefix) — 10 specs matching customer_intelligence
const acquisitionAgents = [
  { name: 'New Subdivision Detector', purpose: 'Detects new residential subdivisions in our service zones (high-acquisition-value zip code clusters). Listens for CUSTOMER_INTELLIGENCE_REQUEST_NEW_SUBDIVISION_DETECTOR.' },
  { name: 'Referral Program Performance', purpose: 'Tracks per-source referral acquisition cost + retention. Listens for CUSTOMER_INTELLIGENCE_REQUEST_REFERRAL_PROGRAM_PERFORMANCE.' },
  { name: 'Cold Outreach Eligibility Scorer', purpose: 'Identifies churned customers eligible for re-engagement outreach. Listens for CUSTOMER_INTELLIGENCE_REQUEST_COLD_OUTREACH_ELIGIBILITY.' },
  { name: 'Home Warranty Vendor Onboarding Suggestor', purpose: 'Suggests new home-warranty vendor partnerships based on inbound customer demand for unrouted vendors. Listens for CUSTOMER_INTELLIGENCE_REQUEST_HW_VENDOR_ONBOARDING_SUGGESTOR.' },
  { name: 'Service Zone Expansion Recommender', purpose: 'Recommends next service zone to expand into based on inbound declines + competitor weakness. Listens for CUSTOMER_INTELLIGENCE_REQUEST_SERVICE_ZONE_EXPANSION.' },
  { name: 'Tech Recruiting Demand Forecaster', purpose: 'Forecasts when we need to add a tech based on growth rate per region. Listens for CUSTOMER_INTELLIGENCE_REQUEST_TECH_RECRUITING_DEMAND_FORECASTER.' },
  { name: 'Lead Source Attribution', purpose: 'Attributes inbound jobs to specific lead sources (organic / paid / referral / warranty vendor). Listens for CUSTOMER_INTELLIGENCE_REQUEST_LEAD_SOURCE_ATTRIBUTION.' },
  { name: 'Customer Retention Cohort Analyzer', purpose: 'Computes repeat-rate per acquisition cohort. Listens for CUSTOMER_INTELLIGENCE_REQUEST_CUSTOMER_RETENTION_COHORT_ANALYZER.' },
  { name: 'Service Area Demand Heatmap', purpose: 'Generates a heatmap of inbound-job density per zip in service area. Listens for CUSTOMER_INTELLIGENCE_REQUEST_SERVICE_AREA_DEMAND_HEATMAP.' },
  { name: 'Customer Acquisition Cost Tracker', purpose: 'Tracks blended CAC per channel + per region. Listens for CUSTOMER_INTELLIGENCE_REQUEST_CUSTOMER_ACQUISITION_COST_TRACKER.' },
];

const officeIdx = colonyIndexByName('Office Efficiency Colony');
const marketingIdx = colonyIndexByName('Marketing and SEO Colony');
const acquisitionIdx = colonyIndexByName('Customer Acquisition Colony');

if (officeIdx >= 0) addAgents(officeIdx, 'OF', 3, officeAgents);
if (marketingIdx >= 0) addAgents(marketingIdx, 'M', 3, marketingAgents);
if (acquisitionIdx >= 0) addAgents(acquisitionIdx, 'CA', 3, acquisitionAgents);

// Refresh top-level meta
bp.meta = bp.meta || {};
bp.meta.agents_total = (bp.colonies || []).reduce((a, c) => a + (c.agents || []).length, 0);
bp.meta.agents_to_build = (bp.colonies || []).reduce(
  (a, c) => a + (c.agents || []).filter((x) => x.status === 'TO_BUILD').length,
  0
);
bp.meta.agents_built = (bp.colonies || []).reduce(
  (a, c) => a + (c.agents || []).filter((x) => x.status === 'BUILT').length,
  0
);
bp.meta.agents_live = (bp.colonies || []).reduce(
  (a, c) => a + (c.agents || []).filter((x) => x.status === 'LIVE').length,
  0
);

fs.writeFileSync(BP_PATH, JSON.stringify(bp, null, 2));
console.log('\nblueprint totals:', bp.meta.agents_total, 'agents,', bp.meta.agents_to_build, 'to_build,', bp.meta.agents_built + bp.meta.agents_live, 'built+live');
