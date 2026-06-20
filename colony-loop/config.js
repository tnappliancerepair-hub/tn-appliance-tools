import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

function loadDotenvInto(env) {
  const p = join(HERE, '.env');
  if (!existsSync(p)) return;
  const raw = readFileSync(p, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (env[key] === undefined) env[key] = val;
  }
}

loadDotenvInto(process.env);

const REQUIRED = [
  'XANO_INTAKE_BASE',
  'XANO_CASH_TDR_BASE',
  'ANTHROPIC_API_KEY',
  'OWNER_PHONE_NUMBER',
];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[config] missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

export const config = Object.freeze({
  xanoIntakeBase: process.env.XANO_INTAKE_BASE.replace(/\/+$/, ''),
  xanoCashTdrBase: process.env.XANO_CASH_TDR_BASE.replace(/\/+$/, ''),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  ownerPhone: process.env.OWNER_PHONE_NUMBER,
  daniellePhone: process.env.DANIELLE_PHONE_NUMBER || '+16154850713',
  vapiPrivateKey: process.env.VAPI_PRIVATE_KEY || '',
  // Vacation mode: when set, every SMS to ownerPhone is ALSO sent to this
  // backup number. Set VACATION_BACKUP_PHONE=+16154850713 before Teddy
  // leaves; unset when he's back. Cheap insurance against missing critical
  // alerts during travel.
  vacationBackupPhone: process.env.VACATION_BACKUP_PHONE || '',
  vacationModeActive: !!(process.env.VACATION_BACKUP_PHONE || '').trim(),
  colonyName: process.env.COLONY_NAME || 'mac-mini-tn',
  // 120s (was 60s) — halves the loop's Xano polling load. The loop is the
  // heaviest Xano client (polls colony_signals + dedup-scans event_log every
  // tick); a wider tick cuts that ~in half with no real downside (time signals
  // still land within ~2 min). Override with TICK_MS env if needed.
  tickMs: Number(process.env.TICK_MS) || 120000,
  dryRun: process.env.DRY_RUN === 'true',
  logLevel: process.env.LOG_LEVEL || 'info',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
  autoFireConfidence: Number(process.env.AUTO_FIRE_CONFIDENCE) || 0.7,
  alwaysEscalateFirstN: Number(process.env.ALWAYS_ESCALATE_FIRST_N) || 20,
  quietStartHourCT: 21,
  quietEndHourCT: 8,
  publicSiteBase: process.env.PUBLIC_SITE_BASE || 'https://tnapplianceexchange.net',
  netlifyFunctionsBase: process.env.NETLIFY_FUNCTIONS_BASE || 'https://superlative-naiad-233aa7.netlify.app/.netlify/functions',
  // SaaS multi-tenant: the company_id this loop process operates as.
  // For TN Appliance Mac Mini, this stays 1. Future per-tenant loops
  // would set COMPANY_ID env. Most agents read this when querying
  // company-scoped data.
  companyId: Number(process.env.COMPANY_ID) || 1,
  // Office password the loop uses to write a tech's in-app inbox
  // (send_office_to_tech_message). Matches the XS default.
  officePassword: process.env.OFFICE_PASSWORD || 'antlives',
  // When true (default), every tech notification is ALSO dropped into the tech's
  // in-app Messages inbox — including the ones muted from SMS (weekend + digests)
  // that previously just vanished. Set TECH_INBOX_ENABLED=false to disable. This
  // is the move that fills the in-app inbox so SMS can retire.
  techInboxEnabled: String(process.env.TECH_INBOX_ENABLED || 'true') !== 'false',
  // Fire a native push for tech notifications (send-push Netlify fn). OFF until
  // the native app ships + APNs/FCM keys are in the vault. Flip PUSH_ENABLED=true
  // then. send-push itself no-ops gracefully if keys are missing, so this is a
  // belt-and-suspenders gate to avoid wasted calls.
  pushEnabled: String(process.env.PUSH_ENABLED || 'false') === 'true',
  // FORWARD-ONLY customer outreach. A job created BEFORE this cutoff (the
  // backlog) NEVER gets an availability/pre-diagnosis text — only new jobs from
  // here forward do. Default = 2026-06-20 00:00 CT (today). Override with
  // CUSTOMER_OUTREACH_SINCE_MS. Set to 0 to disable the cutoff.
  customerOutreachSinceMs: (process.env.CUSTOMER_OUTREACH_SINCE_MS != null)
    ? Number(process.env.CUSTOMER_OUTREACH_SINCE_MS)
    : Date.parse('2026-06-20T05:00:00Z'),
  // Auto-booking kill-switch. When 'true', try_auto_schedule's
  // green-light path will actually book the job (tech + slot derived
  // from zip + parts_eta_date) instead of just sending Teddy three
  // options to manually pick. Defaults OFF until smoke-verified live.
  autoBookEnabled: process.env.AUTO_BOOK_ENABLED === 'true',
  // Route-fill (the "ultimate tech partner"): when true, a tech running
  // ahead is texted DIRECTLY with nearby open jobs ("reply 1/2/no"); when
  // false (default), only Teddy gets the candidate list to validate the
  // signal + candidate quality before techs are pinged. Flip on after the
  // core cutover, once Danielle + techs live in Ant daily.
  routeFillLive: process.env.ROUTE_FILL_LIVE === 'true',
  // Self-scheduling autopilot — tech job offer. When true, the computed
  // route-smart, availability-honoring offer is texted DIRECTLY to the tech
  // (one-tap accept → auto-books → customer confirmed). When false (default,
  // SHADOW), it texts Teddy what it WOULD offer so we validate the picks
  // before techs are pinged. See docs/self-scheduling-autopilot-plan-2026-06-19.md.
  techOfferLive: process.env.TECH_OFFER_LIVE === 'true',
  // Whether the autopilot's OFFER path runs at all on new jobs (computes a
  // route-smart, availability-honoring pick → emits TECH_JOB_OFFER). Default
  // off → job_intake_complete keeps its current behavior. Turn ON (with
  // TECH_OFFER_LIVE still off) to SHADOW: Ant computes real offers + previews
  // them to Teddy, no tech pinged. Then flip TECH_OFFER_LIVE to go live.
  techOfferEnabled: process.env.TECH_OFFER_ENABLED === 'true',
  // Claude call audit endpoint — fire-and-forget logged from claude.js
  // on every API call (success, error, timeout, dry-run). Empty disables
  // logging (back-compat). Set automatically from xanoIntakeBase below.
  recordClaudeCallEndpoint: (process.env.XANO_INTAKE_BASE || '').replace(/\/+$/, '') + '/record_claude_call',
  // Daily Claude spend alert threshold in $USD. The daily watchdog
  // SMSes Teddy if yesterday's total cost_usd exceeds this. Set in
  // Netlify / Mac Mini env. Default $25/day — adjust based on actual
  // usage trends.
  dailyClaudeSpendAlertUsd: Number(process.env.DAILY_CLAUDE_SPEND_ALERT_USD) || 25,
});
