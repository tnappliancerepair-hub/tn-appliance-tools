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
  colonyName: process.env.COLONY_NAME || 'mac-mini-tn',
  tickMs: Number(process.env.TICK_MS) || 60000,
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
});
