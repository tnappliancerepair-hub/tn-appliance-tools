#!/usr/bin/env node
// Round 2 blueprint expansion. Adds ~50 new TO_BUILD specs across Parts,
// Voice/SMS, and Business Intelligence (financial tracking) colonies.
// Inherits the same idempotent ID-suffix logic as expand-blueprint.js.

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
      xano_endpoint: a.xano_endpoint || (a.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
      dependencies: a.dependencies || [],
    });
    inserted.push(id);
  }
  col.agents_total = col.agents.length;
  console.log(`[colony ${colonyIndex} ${col.name}] +${inserted.length}: ${inserted[0]}..${inserted[inserted.length - 1]}`);
  return inserted;
}

// ── Parts round 2: 2 more suppliers × 7 categories = 14, plus 6 quality agents
const SUPPLIERS_R2 = [
  { slug: 'reliable_parts', display: 'Reliable Parts' },
  { slug: 'genuine_replacement_parts', display: 'Genuine Replacement Parts' },
];
const APPLIANCE_CATS = ['washer', 'dryer', 'dishwasher', 'refrigerator', 'range', 'microwave', 'hvac'];
const partsAgentsR2 = [];
for (const sup of SUPPLIERS_R2) {
  for (const cat of APPLIANCE_CATS) {
    partsAgentsR2.push({
      name: `${sup.display} ${cat.charAt(0).toUpperCase() + cat.slice(1)} Parts Agent`,
      priority: 2,
      purpose: `${sup.display} sourcing for ${cat}: price, availability, ETA, cross-references. Listens for PARTS_LOOKUP_${sup.slug.toUpperCase()}_${cat.toUpperCase()}.`,
      triggers: [`PARTS_LOOKUP_${sup.slug.toUpperCase()}_${cat.toUpperCase()}`],
      outputs: ['PARTS_INTELLIGENCE'],
    });
  }
}
const partsQualityAgents = [
  { name: 'Parts Lookup Reorder Pattern Detector', priority: 2, purpose: 'Detects techs ordering the same part 3+ times in a month for different jobs, flags as candidate for truck-stock.', triggers: ['PARTS_LOOKUP_REORDER_PATTERN_DETECTOR'], outputs: ['PARTS_INTELLIGENCE'] },
  { name: 'Parts Lookup Truck Stock Recommender', priority: 2, purpose: 'Recommends per-tech truck-stock additions based on 90-day usage patterns. Reduces parts-trip rescheduling.', triggers: ['PARTS_LOOKUP_TRUCK_STOCK_RECOMMENDER'], outputs: ['PARTS_INTELLIGENCE'] },
  { name: 'Parts Lookup Return Rate Tracker', priority: 2, purpose: 'Tracks return rates per supplier per part category. Identifies counterfeit or low-quality supplier sources.', triggers: ['PARTS_LOOKUP_RETURN_RATE_TRACKER'], outputs: ['PARTS_INTELLIGENCE'] },
  { name: 'Parts Lookup Warranty Eligibility Matcher', priority: 2, purpose: 'Matches OEM part numbers to manufacturer warranty programs (Whirlpool ServicePower, GE Direct, LG Direct).', triggers: ['PARTS_LOOKUP_WARRANTY_ELIGIBILITY_MATCHER'], outputs: ['PARTS_INTELLIGENCE'] },
  { name: 'Parts Lookup Discontinued Part Finder', priority: 2, purpose: 'For older appliances where the OEM part is discontinued, finds equivalent or refurbished alternatives across suppliers.', triggers: ['PARTS_LOOKUP_DISCONTINUED_PART_FINDER'], outputs: ['PARTS_INTELLIGENCE'] },
  { name: 'Parts Lookup Universal Part Matcher', priority: 2, purpose: 'Identifies where universal/generic parts can substitute OEM (motor universals, control board flashes, generic timers).', triggers: ['PARTS_LOOKUP_UNIVERSAL_PART_MATCHER'], outputs: ['PARTS_INTELLIGENCE'] },
];
addAgents(2, 'P', 3, [...partsAgentsR2, ...partsQualityAgents]);

// ── Voice/SMS round 2: 15 more conversation types
const CONV_TYPES_R2 = [
  { slug: 'multi_appliance_inquiry',    display: 'Multi Appliance Inquiry' },
  { slug: 'service_area_question',      display: 'Service Area Question' },
  { slug: 'price_quote_request',        display: 'Price Quote Request' },
  { slug: 'warranty_eligibility_check', display: 'Warranty Eligibility Check' },
  { slug: 'manual_request',             display: 'Manual Request' },
  { slug: 'commercial_inquiry',         display: 'Commercial Inquiry' },
  { slug: 'second_opinion_request',     display: 'Second Opinion Request' },
  { slug: 'maintenance_question',       display: 'Maintenance Question' },
  { slug: 'urgent_request',             display: 'Urgent Request' },
  { slug: 'language_help_request',      display: 'Language Help Request' },
  { slug: 'accessibility_request',      display: 'Accessibility Request' },
  { slug: 'gift_referral',              display: 'Gift Referral' },
  { slug: 'media_inquiry',              display: 'Media Inquiry' },
  { slug: 'job_recommendation_request', display: 'Job Recommendation Request' },
  { slug: 'permit_question',            display: 'Permit Question' },
];
const voiceAgentsR2 = CONV_TYPES_R2.map((c) => ({
  name: `${c.display} SMS Responder`,
  priority: 2,
  purpose: `Customer SMS responder for ${c.display.toLowerCase()}. Receives SMS_RESPONSE_${c.slug.toUpperCase()} payload with customer name + phone + job context + inbound body. Emits CUSTOMER_SMS_REPLY.`,
  triggers: [`SMS_RESPONSE_${c.slug.toUpperCase()}`],
  outputs: ['CUSTOMER_SMS_REPLY'],
  xano_endpoint: `sms_response_${c.slug}`,
}));
addAgents(5, 'V', 3, voiceAgentsR2);

// ── Business Intelligence (Colony 8) — financial tracking specialists
const biAgents = [
  { name: 'Business Intel Daily Revenue Tracker', priority: 1, purpose: 'Aggregates daily revenue across all techs from completed jobs + parts margin. Surfaces day-over-day deltas and weekly pace vs target. Emits BUSINESS_INTEL_INSIGHT.', triggers: ['BUSINESS_INTEL_REQUEST_DAILY_REVENUE'], outputs: ['BUSINESS_INTEL_INSIGHT'] },
  { name: 'Business Intel AR Aging Reporter', priority: 1, purpose: 'Tracks outstanding receivables from warranty companies + self-pay balances. Surfaces past-due over 30/60/90 days. Emits BUSINESS_INTEL_INSIGHT.', triggers: ['BUSINESS_INTEL_REQUEST_AR_AGING_REPORTER'], outputs: ['BUSINESS_INTEL_INSIGHT'] },
  { name: 'Business Intel Cash Position Watcher', priority: 1, purpose: 'Watches Stripe + bank balances vs expected payouts. Surfaces low-cash warnings before payroll. Emits BUSINESS_INTEL_INSIGHT.', triggers: ['BUSINESS_INTEL_REQUEST_CASH_POSITION_WATCHER'], outputs: ['BUSINESS_INTEL_INSIGHT'] },
  { name: 'Business Intel Margin Per Job Analyzer', priority: 1, purpose: 'Calculates net margin per completed job (revenue - parts cost - labor cost - vehicle + tool cost). Flags consistently-low-margin patterns by appliance, brand, vendor. Emits BUSINESS_INTEL_INSIGHT.', triggers: ['BUSINESS_INTEL_REQUEST_MARGIN_PER_JOB_ANALYZER'], outputs: ['BUSINESS_INTEL_INSIGHT'] },
  { name: 'Business Intel Warranty Reimbursement Lag', priority: 1, purpose: 'Tracks lag between warranty job completion and reimbursement receipt per vendor. Surfaces slow-payers + flags claims stuck in portal. Emits BUSINESS_INTEL_INSIGHT.', triggers: ['BUSINESS_INTEL_REQUEST_WARRANTY_REIMBURSEMENT_LAG'], outputs: ['BUSINESS_INTEL_INSIGHT'] },
  { name: 'Business Intel Tax Liability Forecaster', priority: 2, purpose: 'Forecasts quarterly tax liability based on YTD net + projected. Surfaces estimated-payment alerts before deadlines. Emits BUSINESS_INTEL_INSIGHT.', triggers: ['BUSINESS_INTEL_REQUEST_TAX_LIABILITY_FORECASTER'], outputs: ['BUSINESS_INTEL_INSIGHT'] },
  { name: 'Business Intel Tech Earnings Reconciler', priority: 1, purpose: 'Compares each tech\'s tech_earnings rows vs jobs.completion_type + commission_rate. Surfaces unpaid commissions + double-pay risks before payroll runs. Emits BUSINESS_INTEL_INSIGHT.', triggers: ['BUSINESS_INTEL_REQUEST_TECH_EARNINGS_RECONCILER'], outputs: ['BUSINESS_INTEL_INSIGHT'] },
  { name: 'Business Intel Fleet Cost Tracker', priority: 2, purpose: 'Tracks fuel + maintenance + insurance per truck per month. Surfaces over-spec trucks for rotation/replacement. Emits BUSINESS_INTEL_INSIGHT.', triggers: ['BUSINESS_INTEL_REQUEST_FLEET_COST_TRACKER'], outputs: ['BUSINESS_INTEL_INSIGHT'] },
  { name: 'Business Intel Customer Acquisition Cost', priority: 2, purpose: 'Calculates CAC per acquisition channel (warranty network, web, referral, vehicle wrap) by dividing channel spend by jobs from that channel. Emits BUSINESS_INTEL_INSIGHT.', triggers: ['BUSINESS_INTEL_REQUEST_CUSTOMER_ACQUISITION_COST'], outputs: ['BUSINESS_INTEL_INSIGHT'] },
  { name: 'Business Intel Profitability By Zone', priority: 2, purpose: 'Net profit per service-zone cluster. Surfaces zones where windshield-time dominates margin so we can adjust pricing or retire. Emits BUSINESS_INTEL_INSIGHT.', triggers: ['BUSINESS_INTEL_REQUEST_PROFITABILITY_BY_ZONE'], outputs: ['BUSINESS_INTEL_INSIGHT'] },
];
addAgents(8, 'BI', 3, biAgents);

// ── Update meta
let totalLive = 0, totalEnumerated = 0;
for (const c of bp.colonies) {
  totalEnumerated += (c.agents || []).length;
  totalLive += (c.agents || []).filter((a) => a.status === 'BUILT' || a.status === 'LIVE').length;
}
bp.meta.agents_live = totalLive;
bp.meta.total_agents_enumerated = totalEnumerated;
bp.meta.agents_to_build = Math.max(0, totalEnumerated - totalLive);

fs.writeFileSync(BP_PATH, JSON.stringify(bp, null, 2));
console.log(`\nblueprint updated: ${totalEnumerated} enumerated, ${totalLive} live, ${bp.meta.agents_to_build} to_build.`);
