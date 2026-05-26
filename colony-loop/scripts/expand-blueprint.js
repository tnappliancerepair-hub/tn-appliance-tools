#!/usr/bin/env node
// HOUR 5 — expands docs/appliance-ant-master-blueprint.json with TO_BUILD
// specs targeting the architect's existing templates. After this runs +
// commits, the next COLONY_ARCHITECT firing has fresh work to do.
//
// Focus per user's prompt:
//   • Parts intelligence (Colony 2)        — supplier × appliance grid
//   • Voice + SMS conversation types (5)   — sms_response_* responders
//   • Scheduling S-series (3)              — fills out S021-S035 wave
// Plus targeted fills in HVAC, Recruiting, Customer Intel, Tech Performance.

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
    const entry = {
      id,
      name: a.name,
      status: 'TO_BUILD',
      priority: a.priority || 2,
      purpose: a.purpose,
      triggers: a.triggers || [],
      outputs: a.outputs || [],
      xano_endpoint: a.xano_endpoint || (a.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
      dependencies: a.dependencies || [],
    };
    col.agents.push(entry);
    inserted.push(id);
  }
  // Update colony counters
  col.agents_total = col.agents.length;
  // agents_live stays the same; agents_to_build implicit
  console.log(`[colony ${colonyIndex} ${col.name}] +${inserted.length}: ${inserted[0]}..${inserted[inserted.length - 1]}`);
  return inserted;
}

// ── Parts: 5 suppliers × 7 appliance categories = 35, plus 5 cross-cutting
const SUPPLIERS = [
  { slug: 'marcone',         display: 'Marcone' },
  { slug: 'triple_s',        display: 'Triple S' },
  { slug: 'appliancepartspros', display: 'AppliancePartsPros' },
  { slug: 'repairclinic',    display: 'RepairClinic' },
  { slug: 'partselect',      display: 'PartSelect' },
];
const APPLIANCE_CATS = ['washer', 'dryer', 'dishwasher', 'refrigerator', 'range', 'microwave', 'hvac'];

const partsAgents = [];
for (const sup of SUPPLIERS) {
  for (const cat of APPLIANCE_CATS) {
    partsAgents.push({
      name: `${sup.display} ${cat.charAt(0).toUpperCase() + cat.slice(1)} Parts Agent`,
      priority: 2,
      purpose: `Source ${cat} OEM parts from ${sup.display}: price, availability, ETA, cross-references. Listens for PARTS_LOOKUP_${sup.slug.toUpperCase()}_${cat.toUpperCase()} signals carrying brand + model + failed_component, emits PARTS_INTELLIGENCE with structured pricing + stock data.`,
      triggers: [`PARTS_LOOKUP_${sup.slug.toUpperCase()}_${cat.toUpperCase()}`],
      outputs: ['PARTS_INTELLIGENCE'],
      xano_endpoint: `parts_${sup.slug}_${cat}`,
    });
  }
}
// 5 cross-cutting parts agents
const partsCrossCutting = [
  {
    name: 'Parts Arbitrage Optimizer',
    priority: 2,
    purpose: 'Compare PARTS_INTELLIGENCE signals across suppliers for the same job_id + part_number, recommend cheapest in-stock source. Emits PARTS_ARBITRAGE_RECOMMENDATION.',
    triggers: ['PARTS_INTELLIGENCE'],
    outputs: ['PARTS_ARBITRAGE_RECOMMENDATION'],
  },
  {
    name: 'Parts Backorder Watcher',
    priority: 2,
    purpose: 'Watches ordered parts with parts_status=on_order. When ETA slips past promised date, emits PARTS_DELAY_ALERT and SMSes Teddy with options.',
    triggers: ['PARTS_LOOKUP_BACKORDER_WATCH'],
    outputs: ['PARTS_DELAY_ALERT'],
  },
  {
    name: 'Parts Cross-Reference Resolver',
    priority: 2,
    purpose: 'Given a part_number for one brand, finds OEM-equivalent part numbers across other supplier catalogs. Useful when primary supplier is out of stock.',
    triggers: ['PARTS_LOOKUP_CROSSREF'],
    outputs: ['PARTS_INTELLIGENCE'],
  },
  {
    name: 'Parts Authenticity Verifier',
    priority: 2,
    purpose: 'When a third-party (non-OEM) part is proposed, runs the OEM number through known counterfeit signal patterns and flags risk. Emits PARTS_AUTHENTICITY_FLAGGED on risk.',
    triggers: ['PARTS_LOOKUP_AUTHENTICITY'],
    outputs: ['PARTS_AUTHENTICITY_FLAGGED'],
  },
  {
    name: 'Parts Shipping ETA Predictor',
    priority: 2,
    purpose: 'Predicts truck-on-site ETA for parts from each supplier given current zone, day of week, supplier shipping policies. Improves over time via PARTS_DELIVERY_OUTCOME feedback.',
    triggers: ['PARTS_LOOKUP_SHIPPING_ETA'],
    outputs: ['PARTS_INTELLIGENCE'],
  },
];
addAgents(2, 'P', 3, [...partsAgents, ...partsCrossCutting]);

// ── Voice + SMS: 25 conversation types ──
const CONV_TYPES = [
  { slug: 'appointment_confirmation',    display: 'Appointment Confirmation' },
  { slug: 'reschedule_request',          display: 'Reschedule Request' },
  { slug: 'cancel_request',              display: 'Cancel Request' },
  { slug: 'parts_arrival_eta',           display: 'Parts Arrival ETA' },
  { slug: 'parts_delay',                 display: 'Parts Delay' },
  { slug: 'payment_due',                 display: 'Payment Due' },
  { slug: 'payment_received',            display: 'Payment Received' },
  { slug: 'technician_eta',              display: 'Technician ETA' },
  { slug: 'technician_late',             display: 'Technician Late' },
  { slug: 'tech_no_show',                display: 'Tech No Show' },
  { slug: 'complaint',                   display: 'Complaint' },
  { slug: 'refund_request',              display: 'Refund Request' },
  { slug: 'warranty_question',           display: 'Warranty Question' },
  { slug: 'post_job_feedback',           display: 'Post Job Feedback' },
  { slug: 'positive_review_followup',    display: 'Positive Review Followup' },
  { slug: 'negative_review_followup',    display: 'Negative Review Followup' },
  { slug: 'opt_out',                     display: 'Opt Out' },
  { slug: 'repeat_customer_greeting',    display: 'Repeat Customer Greeting' },
  { slug: 'photo_request',               display: 'Photo Request' },
  { slug: 'model_number_request',        display: 'Model Number Request' },
  { slug: 'address_correction',          display: 'Address Correction' },
  { slug: 'gate_code_request',           display: 'Gate Code Request' },
  { slug: 'callback_request',            display: 'Callback Request' },
  { slug: 'escalation_acknowledgement',  display: 'Escalation Acknowledgement' },
  { slug: 'after_hours_response',        display: 'After Hours Response' },
];
const voiceAgents = CONV_TYPES.map((c) => ({
  name: `${c.display} SMS Responder`,
  priority: 2,
  purpose: `Customer SMS responder for ${c.display.toLowerCase()} conversations. Receives SMS_RESPONSE_${c.slug.toUpperCase()} payload with customer name + phone + job context + inbound body, emits CUSTOMER_SMS_REPLY with a single 1-2 segment reply matched to TN Appliance Exchange voice + tone.`,
  triggers: [`SMS_RESPONSE_${c.slug.toUpperCase()}`],
  outputs: ['CUSTOMER_SMS_REPLY'],
  xano_endpoint: `sms_response_${c.slug}`,
}));
addAgents(5, 'V', 3, voiceAgents);

// ── Scheduling: S021..S035 (15 new) ──
const scheduleAgents = [
  { name: 'Gap Filler', purpose: 'Watches calendar for sub-2hr gaps between scheduled jobs per tech. Surfaces fill opportunities (same-day reschedules, hot leads near the gap zone). Emits SCHEDULING_DECISION.', triggers: ['SCHEDULE_REQUEST_GAP_FILL'], outputs: ['SCHEDULING_DECISION'] },
  { name: 'Cluster Geometry Optimizer', purpose: 'Re-clusters next-day routes by zip/cluster to minimize windshield time. Emits SCHEDULING_DECISION with proposed reorderings.', triggers: ['SCHEDULE_REQUEST_CLUSTER_GEOMETRY'], outputs: ['SCHEDULING_DECISION'] },
  { name: 'Traffic Aware ETA Adjuster', purpose: 'Layers Google Distance Matrix traffic data on top of scheduled_start to refine customer ETAs as the morning progresses. Emits SCHEDULING_DECISION.', triggers: ['SCHEDULE_REQUEST_TRAFFIC_ADJUST'], outputs: ['SCHEDULING_DECISION'] },
  { name: 'Tech Specialty Router', purpose: 'When a job has elevated complexity (rare brand, multi-appliance, HVAC), routes to the tech with the highest historical success rate on that pattern. Emits SCHEDULING_DECISION.', triggers: ['SCHEDULE_REQUEST_SPECIALTY_ROUTE'], outputs: ['SCHEDULING_DECISION'] },
  { name: 'No Show Recovery Scheduler', purpose: 'After a customer no-show, decides whether to immediately rebook, switch the slot to a different customer, or escalate. Emits SCHEDULING_DECISION.', triggers: ['SCHEDULE_REQUEST_NO_SHOW_RECOVERY'], outputs: ['SCHEDULING_DECISION'] },
  { name: 'Recurring Job Anchor', purpose: 'For service agreements + repeat customers, anchors their next maintenance visit to optimal tech + slot. Emits SCHEDULING_DECISION.', triggers: ['SCHEDULE_REQUEST_RECURRING_ANCHOR'], outputs: ['SCHEDULING_DECISION'] },
  { name: 'Day Balancer', purpose: 'Spots techs with overweighted days vs. light days and emits suggested intra-week rebalances. Emits SCHEDULING_DECISION.', triggers: ['SCHEDULE_REQUEST_DAY_BALANCE'], outputs: ['SCHEDULING_DECISION'] },
  { name: 'Last Minute Filler', purpose: 'When same-day slot opens (cancellation, parts arrived early), finds the best waiting-customer match by urgency + proximity. Emits SCHEDULING_DECISION.', triggers: ['SCHEDULE_REQUEST_LAST_MIN'], outputs: ['SCHEDULING_DECISION'] },
  { name: 'Schedule Health Scorer', purpose: 'Daily metric: how packed, how clustered, how reschedule-prone is each tech\'s week? Emits SCHEDULING_HEALTH_SCORE.', triggers: ['SCHEDULE_REQUEST_HEALTH_SCORE'], outputs: ['SCHEDULING_HEALTH_SCORE'] },
  { name: 'Capacity Predictor', purpose: 'Predicts next-week per-tech capacity based on recent same-week patterns. Surfaces over/under-staffing. Emits SCHEDULING_DECISION.', triggers: ['SCHEDULE_REQUEST_CAPACITY_FORECAST'], outputs: ['SCHEDULING_DECISION'] },
  { name: 'Job Duration Learner', purpose: 'Learns true job durations per (appliance × brand × failure) and refines future scheduled_end_ms suggestions. Emits SCHEDULING_DECISION.', triggers: ['SCHEDULE_REQUEST_DURATION_REFINE'], outputs: ['SCHEDULING_DECISION'] },
  { name: 'Sick Day Cascade Refiner', purpose: 'When a tech calls out, refines the existing sick_day_cascade behavior with smarter customer-first reassignments (preferring no-disruption swaps). Emits SCHEDULING_DECISION.', triggers: ['SCHEDULE_REQUEST_SICK_CASCADE'], outputs: ['SCHEDULING_DECISION'] },
  { name: 'Weather Aware Rescheduler', purpose: 'When severe weather is forecast, proposes pre-emptive reschedules for outdoor (HVAC) jobs. Emits SCHEDULING_DECISION.', triggers: ['SCHEDULE_REQUEST_WEATHER'], outputs: ['SCHEDULING_DECISION'] },
  { name: 'Customer Preference Aligner', purpose: 'When the customer_preference_text indicates morning/afternoon/specific-day preference, biases slot scoring accordingly. Emits SCHEDULING_DECISION.', triggers: ['SCHEDULE_REQUEST_PREFERENCE_ALIGN'], outputs: ['SCHEDULING_DECISION'] },
  { name: 'Holiday Schedule Adjuster', purpose: 'Detects upcoming federal/state/observed holidays + flexes capacity/availability accordingly. Emits SCHEDULING_DECISION.', triggers: ['SCHEDULE_REQUEST_HOLIDAY'], outputs: ['SCHEDULING_DECISION'] },
];
addAgents(3, 'S', 3, scheduleAgents);

// ── HVAC fill (Colony 14) ──
const hvacAgents = [
  { name: 'Refrigerant Recovery Compliance', purpose: 'Per EPA 608 recovery requirements, watches for missing recovery records on completed HVAC jobs and alerts. Emits HVAC_INTELLIGENCE.', triggers: ['HVAC_AUDIT_RECOVERY'], outputs: ['HVAC_INTELLIGENCE'] },
  { name: 'Heat Pump Diagnostic Reasoning', purpose: 'Specialist diagnostic agent for heat pump faults (reversing valve, charge issues, defrost board, expansion devices). Emits DIAGNOSTIC_BRIEF for HVAC jobs.', triggers: ['DIAGNOSE_HVAC_HEAT_PUMP'], outputs: ['DIAGNOSTIC_BRIEF'] },
  { name: 'Furnace Combustion Analyzer', purpose: 'Specialist diagnostic agent for furnace combustion + flame sensor + ignition issues. Emits DIAGNOSTIC_BRIEF.', triggers: ['DIAGNOSE_HVAC_FURNACE'], outputs: ['DIAGNOSTIC_BRIEF'] },
  { name: 'AC Charge Calculator', purpose: 'Calculates expected superheat/subcooling targets given outdoor temp + indoor wet bulb + refrigerant type. Emits HVAC_INTELLIGENCE.', triggers: ['HVAC_LOOKUP_CHARGE'], outputs: ['HVAC_INTELLIGENCE'] },
  { name: 'HVAC Filter Replacement Reminder', purpose: 'For service agreement customers, schedules + sends filter replacement reminders by air handler + zone. Emits HVAC_INTELLIGENCE.', triggers: ['HVAC_FILTER_REMIND'], outputs: ['HVAC_INTELLIGENCE'] },
  { name: 'HVAC Duct Loss Estimator', purpose: 'Estimates duct system loss from total return + supply temps + airflow. Surfaces upsell opportunities for duct repair. Emits HVAC_INTELLIGENCE.', triggers: ['HVAC_LOOKUP_DUCT_LOSS'], outputs: ['HVAC_INTELLIGENCE'] },
  { name: 'HVAC Capacity Sizing Validator', purpose: 'Given square footage + climate zone, validates whether installed equipment is correctly sized. Surfaces oversized/undersized installs. Emits HVAC_INTELLIGENCE.', triggers: ['HVAC_LOOKUP_SIZING'], outputs: ['HVAC_INTELLIGENCE'] },
  { name: 'HVAC Brand Bulletin Watcher', purpose: 'Monitors carrier/trane/lennox/goodman service bulletins + recalls for installed equipment in our customer base. Emits HVAC_INTELLIGENCE on match.', triggers: ['HVAC_AUDIT_BULLETINS'], outputs: ['HVAC_INTELLIGENCE'] },
  { name: 'HVAC Tax Credit Surfacer', purpose: 'For new install opportunities, surfaces applicable IRS energy-efficiency tax credits given the equipment chosen. Emits HVAC_INTELLIGENCE.', triggers: ['HVAC_LOOKUP_TAX_CREDIT'], outputs: ['HVAC_INTELLIGENCE'] },
  { name: 'HVAC Indoor Air Quality Specialist', purpose: 'Reads job notes for IAQ flags (mold, allergens, humidity), recommends UV lamps, ionizers, dehumidifiers. Emits HVAC_INTELLIGENCE.', triggers: ['HVAC_LOOKUP_IAQ'], outputs: ['HVAC_INTELLIGENCE'] },
];
addAgents(14, 'H', 3, hvacAgents);

// ── Recruiting (Colony 18) — 10 more ──
const recruitingAgents = [
  { name: 'Indeed Posting Generator', purpose: 'Generates Indeed job postings tuned to TN Appliance Exchange voice + role + market. Emits RECRUITING_INTELLIGENCE.', triggers: ['RECRUITING_REQUEST_INDEED_POST'], outputs: ['RECRUITING_INTELLIGENCE'] },
  { name: 'Resume Quality Scorer', purpose: 'Scores incoming applicant resumes for fit (years exp, brand familiarity, license, geography). Emits RECRUITING_INTELLIGENCE.', triggers: ['RECRUITING_REQUEST_RESUME_SCORE'], outputs: ['RECRUITING_INTELLIGENCE'] },
  { name: 'Phone Screen Generator', purpose: 'Drafts an initial phone-screen question set tailored to the applicant\'s resume + claimed experience. Emits RECRUITING_INTELLIGENCE.', triggers: ['RECRUITING_REQUEST_PHONE_SCREEN'], outputs: ['RECRUITING_INTELLIGENCE'] },
  { name: 'Onboarding Document Builder', purpose: 'Generates W-9/1099, equipment handoff list, mentor pairing form for new hires. Emits RECRUITING_INTELLIGENCE.', triggers: ['RECRUITING_REQUEST_ONBOARDING_DOCS'], outputs: ['RECRUITING_INTELLIGENCE'] },
  { name: 'Background Check Coordinator', purpose: 'Orchestrates background check vendor + DMV + drug screen + result aggregation. Emits RECRUITING_INTELLIGENCE.', triggers: ['RECRUITING_REQUEST_BACKGROUND_CHECK'], outputs: ['RECRUITING_INTELLIGENCE'] },
  { name: 'Referral Program Manager', purpose: 'Tracks employee referrals, eligibility, payout timing. Emits RECRUITING_INTELLIGENCE.', triggers: ['RECRUITING_REQUEST_REFERRAL_MANAGE'], outputs: ['RECRUITING_INTELLIGENCE'] },
  { name: 'Compensation Benchmarker', purpose: 'Compares offered compensation to regional market rates (Indeed, Glassdoor, BLS). Emits RECRUITING_INTELLIGENCE.', triggers: ['RECRUITING_REQUEST_COMP_BENCHMARK'], outputs: ['RECRUITING_INTELLIGENCE'] },
  { name: 'Candidate Ghost Followup', purpose: 'For candidates who went silent mid-process, generates a respectful single follow-up SMS. Emits RECRUITING_INTELLIGENCE.', triggers: ['RECRUITING_REQUEST_GHOST_FOLLOWUP'], outputs: ['RECRUITING_INTELLIGENCE'] },
  { name: 'Job Description Refresher', purpose: 'Quarterly refresh of all job descriptions based on what duties have actually shifted. Emits RECRUITING_INTELLIGENCE.', triggers: ['RECRUITING_REQUEST_JD_REFRESH'], outputs: ['RECRUITING_INTELLIGENCE'] },
  { name: 'Trade School Outreach', purpose: 'Coordinates outreach to local trade schools + community colleges for entry-level pipeline. Emits RECRUITING_INTELLIGENCE.', triggers: ['RECRUITING_REQUEST_SCHOOL_OUTREACH'], outputs: ['RECRUITING_INTELLIGENCE'] },
];
addAgents(18, 'REC', 3, recruitingAgents);

// ── Customer Intelligence (Colony 6) — 10 more ──
const customerIntelAgents = [
  { name: 'Customer Churn Risk Scorer', purpose: 'Scores existing customers on probability of next-12-month churn given recency, complaint history, NPS. Emits CUSTOMER_INTELLIGENCE.', triggers: ['CUSTOMER_INTEL_CHURN_SCORE'], outputs: ['CUSTOMER_INTELLIGENCE'] },
  { name: 'Customer Segment Classifier', purpose: 'Classifies each customer into archetypes (price-sensitive, premium, warranty-only, multi-property). Emits CUSTOMER_INTELLIGENCE.', triggers: ['CUSTOMER_INTEL_SEGMENT'], outputs: ['CUSTOMER_INTELLIGENCE'] },
  { name: 'Multi-Appliance Household Tagger', purpose: 'Identifies households with 3+ serviced appliances + flags for service agreement upsell. Emits CUSTOMER_INTELLIGENCE.', triggers: ['CUSTOMER_INTEL_MULTI_APPLIANCE'], outputs: ['CUSTOMER_INTELLIGENCE'] },
  { name: 'Customer Communication Preference Learner', purpose: 'Learns preferred channel (SMS vs voice vs email) and time-of-day from response patterns. Emits CUSTOMER_INTELLIGENCE.', triggers: ['CUSTOMER_INTEL_COMM_PREF'], outputs: ['CUSTOMER_INTELLIGENCE'] },
  { name: 'Customer Sentiment Tracker', purpose: 'Tracks sentiment across inbound SMS, voice transcripts, reviews. Surfaces declining customers before they leave. Emits CUSTOMER_INTELLIGENCE.', triggers: ['CUSTOMER_INTEL_SENTIMENT'], outputs: ['CUSTOMER_INTELLIGENCE'] },
  { name: 'Property Owner Type Classifier', purpose: 'Distinguishes homeowner / renter / property manager / commercial. Adjusts comms accordingly. Emits CUSTOMER_INTELLIGENCE.', triggers: ['CUSTOMER_INTEL_OWNER_TYPE'], outputs: ['CUSTOMER_INTELLIGENCE'] },
  { name: 'Customer Birthday Watcher', purpose: 'For high-LTV customers, surfaces birthday window for relationship-marketing SMS. Emits CUSTOMER_INTELLIGENCE.', triggers: ['CUSTOMER_INTEL_BIRTHDAY'], outputs: ['CUSTOMER_INTELLIGENCE'] },
  { name: 'Customer Geographic Cluster Density', purpose: 'Identifies geographic clusters of customers (zip + density) for territory + marketing optimization. Emits CUSTOMER_INTELLIGENCE.', triggers: ['CUSTOMER_INTEL_GEO_CLUSTER'], outputs: ['CUSTOMER_INTELLIGENCE'] },
  { name: 'Customer Referral Source Tracker', purpose: 'Attributes customers to acquisition source (warranty, web, referral, vehicle wrap, etc) and learns conversion + LTV per source. Emits CUSTOMER_INTELLIGENCE.', triggers: ['CUSTOMER_INTEL_REFERRAL_TRACK'], outputs: ['CUSTOMER_INTELLIGENCE'] },
  { name: 'Customer Review Solicitation Optimizer', purpose: 'Picks the optimal moment + channel + ask format to solicit a Google review. Emits CUSTOMER_INTELLIGENCE.', triggers: ['CUSTOMER_INTEL_REVIEW_ASK'], outputs: ['CUSTOMER_INTELLIGENCE'] },
];
addAgents(6, 'CI', 3, customerIntelAgents);

// ── Tech Performance (Colony 7) — 10 more performance_coach agents ──
const techPerfAgents = [
  { name: 'First Visit Fix Rate Coach', purpose: 'Tech performance coaching on first-visit-fix rate; identifies pattern misses, suggests skill gaps to close. Emits PERFORMANCE_COACHING.', triggers: ['PERFORMANCE_COACH_FVF_RATE'], outputs: ['PERFORMANCE_COACHING'] },
  { name: 'Diagnostic Accuracy Coach', purpose: 'Compares predicted failure mode (from diagnose_*) to actual TDR + identifies tech accuracy patterns. Emits PERFORMANCE_COACHING.', triggers: ['PERFORMANCE_COACH_DIAG_ACCURACY'], outputs: ['PERFORMANCE_COACHING'] },
  { name: 'Time Per Job Coach', purpose: 'Coaches techs on jobs taking materially longer than learned baseline for that pattern. Emits PERFORMANCE_COACHING.', triggers: ['PERFORMANCE_COACH_TIME_PER_JOB'], outputs: ['PERFORMANCE_COACHING'] },
  { name: 'Callback Rate Coach', purpose: 'Identifies techs with elevated callback rates on specific brand/pattern combos. Emits PERFORMANCE_COACHING.', triggers: ['PERFORMANCE_COACH_CALLBACK_RATE'], outputs: ['PERFORMANCE_COACHING'] },
  { name: 'Customer Communication Coach', purpose: 'Reads customer feedback + complaints + identifies tech-side communication patterns that drive negative outcomes. Emits PERFORMANCE_COACHING.', triggers: ['PERFORMANCE_COACH_COMMUNICATION'], outputs: ['PERFORMANCE_COACHING'] },
  { name: 'Upsell Opportunity Coach', purpose: 'Surfaces techs who consistently miss obvious upsell flags (service agreement, multi-appliance, IAQ). Emits PERFORMANCE_COACHING.', triggers: ['PERFORMANCE_COACH_UPSELL'], outputs: ['PERFORMANCE_COACHING'] },
  { name: 'Tool Pack Discipline Coach', purpose: 'Monitors tool_pack_minutes drift and coaches techs whose buffer is consistently off (over-prep waste vs under-prep delays). Emits PERFORMANCE_COACHING.', triggers: ['PERFORMANCE_COACH_TOOL_PACK'], outputs: ['PERFORMANCE_COACHING'] },
  { name: 'TDR Completeness Coach', purpose: 'Coaches techs on incomplete TDRs (the warranty submission blocker). Identifies repeat-offender patterns. Emits PERFORMANCE_COACHING.', triggers: ['PERFORMANCE_COACH_TDR_COMPLETENESS'], outputs: ['PERFORMANCE_COACHING'] },
  { name: 'Parts Order Accuracy Coach', purpose: 'Coaches on ordered-wrong-part rate; checks part_number lookup quality vs eventual returned-and-reordered cycles. Emits PERFORMANCE_COACHING.', triggers: ['PERFORMANCE_COACH_PARTS_ACCURACY'], outputs: ['PERFORMANCE_COACHING'] },
  { name: 'Daily Reflection Prompter', purpose: 'End-of-day prompt to each tech (single SMS) asking what slowed them today + what worked. Captures + summarizes. Emits PERFORMANCE_COACHING.', triggers: ['PERFORMANCE_COACH_DAILY_REFLECTION'], outputs: ['PERFORMANCE_COACHING'] },
];
addAgents(7, 'PC', 3, techPerfAgents);

// ── Warranty Claims (Colony 4) — 5 more vendor + claim-state agents ──
const warrantyAgents = [
  { name: 'AHS Claim Status Poller', purpose: 'Polls AHS portal for status updates on submitted claims; emits WARRANTY_CLAIM_STATUS_UPDATE on change.', triggers: ['WARRANTY_REQUEST_POLL_AHS'], outputs: ['WARRANTY_CLAIM_STATUS_UPDATE'] },
  { name: 'ServicePower Claim Status Poller', purpose: 'Polls ServicePower portal for status updates; emits WARRANTY_CLAIM_STATUS_UPDATE on change.', triggers: ['WARRANTY_REQUEST_POLL_SERVICEPOWER'], outputs: ['WARRANTY_CLAIM_STATUS_UPDATE'] },
  { name: 'Frontdoor Claim Status Poller', purpose: 'Polls Frontdoor portal for status updates; emits WARRANTY_CLAIM_STATUS_UPDATE on change.', triggers: ['WARRANTY_REQUEST_POLL_FRONTDOOR'], outputs: ['WARRANTY_CLAIM_STATUS_UPDATE'] },
  { name: 'Warranty Denial Pattern Analyzer', purpose: 'Reads recent warranty denials, identifies repeating denial reasons + which TDR fields are tripping them. Emits WARRANTY_INTELLIGENCE.', triggers: ['WARRANTY_AUDIT_DENIAL_PATTERNS'], outputs: ['WARRANTY_INTELLIGENCE'] },
  { name: 'Warranty Authorization Request Builder', purpose: 'For jobs requiring pre-authorization (high-cost repairs), generates the authorization request package. Emits WARRANTY_AUTHORIZATION_REQUEST.', triggers: ['WARRANTY_REQUEST_AUTHORIZATION'], outputs: ['WARRANTY_AUTHORIZATION_REQUEST'] },
];
addAgents(4, 'W', 3, warrantyAgents);

// ── Service Agreement (Colony 15) — 5 more ──
const saAgents = [
  { name: 'Service Agreement Onboarding Composer', purpose: 'After a customer signs a maintenance plan, composes welcome SMS + first scheduled maintenance preview. Emits SERVICE_AGREEMENT_INTELLIGENCE.', triggers: ['SERVICE_AGREEMENT_REQUEST_ONBOARD'], outputs: ['SERVICE_AGREEMENT_INTELLIGENCE'] },
  { name: 'Service Agreement Renewal Coach', purpose: 'Forecasts renewal probability + suggests renewal-window outreach plan per customer. Emits SERVICE_AGREEMENT_INTELLIGENCE.', triggers: ['SERVICE_AGREEMENT_REQUEST_RENEWAL'], outputs: ['SERVICE_AGREEMENT_INTELLIGENCE'] },
  { name: 'Equipment Age Risk Profiler', purpose: 'Profiles equipment age across the service agreement base + surfaces likely-failure clusters for proactive outreach. Emits SERVICE_AGREEMENT_INTELLIGENCE.', triggers: ['SERVICE_AGREEMENT_REQUEST_AGE_PROFILE'], outputs: ['SERVICE_AGREEMENT_INTELLIGENCE'] },
  { name: 'Post Job Education SMS Composer', purpose: 'Drafts a personalized post-job education message based on the appliance + tech\'s diagnosis + customer\'s prior pattern. Emits SERVICE_AGREEMENT_INTELLIGENCE.', triggers: ['SERVICE_AGREEMENT_REQUEST_POST_JOB_EDU'], outputs: ['SERVICE_AGREEMENT_INTELLIGENCE'] },
  { name: 'Upsell Intelligence Coordinator', purpose: 'Aggregates upsell signals across appliance age, customer LTV, technician notes, geographic clustering, and surfaces top 5 weekly upsell opportunities. Emits SERVICE_AGREEMENT_INTELLIGENCE.', triggers: ['SERVICE_AGREEMENT_REQUEST_UPSELL_COORD'], outputs: ['SERVICE_AGREEMENT_INTELLIGENCE'] },
];
addAgents(15, 'SA', 3, saAgents);

// ── Update top-level meta ──
let totalLive = 0, totalEnumerated = 0;
for (const c of bp.colonies) {
  totalEnumerated += (c.agents || []).length;
  totalLive += (c.agents || []).filter((a) => a.status === 'BUILT' || a.status === 'LIVE').length;
}
bp.meta.agents_live = totalLive;
bp.meta.total_agents_enumerated = totalEnumerated;
bp.meta.agents_to_build = Math.max(0, totalEnumerated - totalLive);

fs.writeFileSync(BP_PATH, JSON.stringify(bp, null, 2));
console.log(`\nblueprint updated: ${totalEnumerated} enumerated, ${totalLive} live, ${bp.meta.agents_to_build} to build.`);
