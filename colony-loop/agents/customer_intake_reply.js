import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(HERE, '..', 'prompts', 'pre_diagnosis.md');
const SYSTEM_PROMPT = readFileSync(PROMPT_PATH, 'utf8');

const DEBOUNCE_MS = 60 * 1000;
const recentRuns = new Map();

export async function run(signal, ctx) {
  const { xano, claude, escalate } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  if (!jobId) throw new Error('payload.job_id required');

  const last = recentRuns.get(jobId);
  if (last && Date.now() - last < DEBOUNCE_MS) {
    return { success: true, action: 'skipped_debounce', job_id: jobId };
  }
  recentRuns.set(jobId, Date.now());

  const cockpit = await xano.qcCockpitLoad(jobId);
  const job = cockpit.job || {};
  const appliance = cockpit.appliance || {};
  const attachments = cockpit.attachments || [];
  const existingTdr = cockpit.existing_tdr || null;
  const customer = cockpit.customer || {};

  const symptomText = (job.problem_summary || appliance.problem_summary || '').trim();
  if (!symptomText && attachments.length === 0) {
    return { success: true, action: 'need_more_data', job_id: jobId };
  }

  const userBlocks = await buildUserMessage({
    xano,
    job,
    appliance,
    customer,
    attachments,
    symptomText,
  });

  const claudeResp = await claude.callClaude({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userBlocks }],
    model: config.claudeModel,
    maxTokens: 1200,
  });

  const raw = claude.textFromResponse(claudeResp);
  const cleaned = claude.stripFences(raw);
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (err) {
    await escalate({
      originalSignalId: signal.id,
      question: `pre-diagnosis json parse failed for job ${jobId}`,
      details: `raw reply: ${raw.slice(0, 200)}`,
    });
    return { success: false, action: 'claude_unparseable', job_id: jobId };
  }

  const confidence = Number(parsed.confidence_0_to_1 || 0);
  const completedCount = await countCompletedPreDiagnoses(xano);
  const inEscalateWindow = completedCount < config.alwaysEscalateFirstN;
  const shouldAutoFire = !inEscalateWindow && !existingTdr && confidence >= config.autoFireConfidence;

  if (shouldAutoFire) {
    await xano.createTdr({
      job_id: jobId,
      mode: 'pre_diagnosis',
      diagnosis: parsed.likely_failure_mode,
      customer_summary: parsed.customer_facing_summary,
      parts_needed: parsed.parts_needed || [],
      confidence,
    });
    const sendRes = await xano.sendQcDiagnosisToCustomer(jobId);
    return {
      success: true,
      action: 'tdr_sent',
      job_id: jobId,
      confidence,
      parts: parsed.parts_needed || [],
      send_result: sendRes,
    };
  }

  await escalate({
    originalSignalId: signal.id,
    question: `pre-diagnosis ready for job ${jobId} (conf ${confidence.toFixed(2)})`,
    options: ['approve', 'reject', 'edit'],
    details: `${parsed.likely_failure_mode}\nparts: ${(parsed.parts_needed||[]).join(', ') || 'none'}\nsummary: ${parsed.customer_facing_summary}`,
  });

  return {
    success: true,
    action: 'awaiting_owner_approval',
    job_id: jobId,
    confidence,
    parts_suggested: parsed.parts_needed || [],
    escalation_reason: inEscalateWindow ? 'first_N_window' : (existingTdr ? 'existing_tdr' : 'low_confidence'),
  };
}

async function countCompletedPreDiagnoses(xano) {
  return 0;
}

async function buildUserMessage({ xano, job, appliance, customer, attachments, symptomText }) {
  const blocks = [];
  const lines = [
    `Customer: ${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
    `Job ID: ${job.id}`,
    `Appliance type: ${appliance.appliance_type || job.appliance_type || 'unknown'}`,
    `Brand: ${appliance.brand || job.brand || 'unknown'}`,
    `Model: ${appliance.model_number || 'unknown'}`,
    `Customer description: ${symptomText || '(no text description provided)'}`,
    `Photos/videos attached: ${attachments.length}`,
  ];
  blocks.push({ type: 'text', text: lines.join('\n') });

  for (const a of attachments) {
    if (!a.s3_key) continue;
    const isImage = (a.file_type === 'photo') || (a.mime_type || '').startsWith('image/');
    if (!isImage) continue;
    try {
      const viewRes = await xano.s3ViewUrl(a.s3_key);
      const url = viewRes?.url || viewRes?.view_url;
      if (!url) continue;
      blocks.push({
        type: 'image',
        source: { type: 'url', url },
      });
    } catch {
    }
  }

  return blocks;
}
