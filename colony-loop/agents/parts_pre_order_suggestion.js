// PARTS_PRE_ORDER_SUGGESTION
//
// Fires on JOB_CREATED for every job that has enough signal (appliance
// + brand + model OR appliance + brand + symptom). Asks the brand
// intelligence agents for the most likely failed-part recommendation,
// then SMSes Teddy with the recommendation + a tap-to-order link.
//
// Goal: move parts ordering from "tech diagnoses on-site → order →
// 2nd visit" to "system predicts → operator orders pre-visit → tech
// brings part on first visit". First-visit-fix rate goes up;
// callback rate goes down.
//
// v1: Claude-based prediction using brand+model+symptom. Calls
// get_common_failures_for_model if there's TDR history for the
// brand+model. Falls back to general brand intelligence.
//
// Future: when Marcone/Tribles Appliance Parts APIs land, this agent will check stock
// + cost + ETA in the recommendation and offer a one-tap order.

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const PREORDER_MODEL = process.env.ANT_PREORDER_MODEL || 'claude-sonnet-4-5-20250929';
const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

const PREORDER_SYSTEM = `You are the Parts Pre-Order Predictor for an appliance repair company. Given a job's appliance type, brand, model (if any), and customer-reported symptom, predict the SINGLE most likely failed component + the SINGLE most likely OEM part number that would fix it.

Reply JSON only:
{
  "failed_component": "<2-4 words>",
  "part_number": "<part number or 'unknown'>",
  "confidence_pct": <0-100>,
  "reasoning": "<one short sentence>",
  "skip_pre_order": <bool — true if not enough info or low confidence>
}

Be brutally honest about confidence. Below 60% → skip_pre_order=true. Don't recommend parts you're not confident about; a wasted parts order costs us $40-80.`;

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);

  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'parts_pre_order_skipped', { reason: 'no_job_id' });
    return { success: false, action: 'skipped' };
  }

  // Dedup — don't fire twice for the same job
  const dedupAction = `parts_pre_order_sent_${jobId}`;
  try {
    const prior = await xano.getEventLogByAction(dedupAction).catch(() => null);
    if (prior && prior.exists) {
      await xano.markSignalProcessed(signal.id, 'parts_pre_order_skipped', { reason: 'already_sent' });
      return { success: true, action: 'skipped_duplicate' };
    }
  } catch (_) {}

  // Pull job context
  let job = null;
  try {
    const r = await xano.getJobForDashboard(jobId).catch(() => null);
    if (r) job = r.job || null;
  } catch (_) {}
  if (!job) {
    await xano.markSignalProcessed(signal.id, 'parts_pre_order_skipped', { reason: 'no_job' });
    return { success: false, action: 'no_job' };
  }

  const appliance = String(job.appliance_type || '').toLowerCase();
  const brand = String(job.brand || '').trim();
  const model = String(job.model_number || '').trim();
  const symptom = String(job.problem_summary || '').trim();

  // Skip if not enough signal
  if (!appliance || !brand || (!model && !symptom)) {
    await xano.markSignalProcessed(signal.id, 'parts_pre_order_skipped', { reason: 'insufficient_signal' });
    return { success: true, action: 'skipped_no_signal' };
  }

  if (!ANTHROPIC_KEY) {
    await xano.markSignalProcessed(signal.id, 'parts_pre_order_skipped', { reason: 'no_key' });
    return { success: false, action: 'no_key' };
  }

  // Ask Claude for prediction
  const userContent = `Appliance: ${appliance}\nBrand: ${brand}\nModel: ${model || 'unknown'}\nSymptom: ${symptom || 'not described'}`;
  let prediction;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: PREORDER_MODEL,
        max_tokens: 400,
        system: PREORDER_SYSTEM,
        messages: [{ role: 'user', content: userContent }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok) {
      const data = await r.json();
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      try { prediction = JSON.parse(cleaned); }
      catch (_) {}
    }
  } catch (e) {
    log('parts_pre_order_claude_failed', { error: String(e) });
  }

  if (!prediction || prediction.skip_pre_order || (prediction.confidence_pct || 0) < 60) {
    await xano.markSignalProcessed(signal.id, 'parts_pre_order_skipped', {
      reason: 'low_confidence_or_skip',
      confidence: prediction && prediction.confidence_pct,
    });
    log('parts_pre_order_skipped', { job_id: jobId, conf: prediction && prediction.confidence_pct });
    return { success: true, action: 'skipped_low_conf' };
  }

  // SMS Teddy with the recommendation + tap-to-order link
  const lookupUrl = `https://www.searspartsdirect.com/model/${encodeURIComponent(model || brand)}/parts`;
  const teddyToolUrl = `https://tnapplianceexchange.net/teddy-tdr-tool.html?job_id=${jobId}`;
  const body = `[ant] pre-order suggestion — job #${jobId} (${appliance}, ${brand}${model ? ' ' + model : ''})
  Predicted: ${prediction.failed_component} (${prediction.confidence_pct}% conf)
  Part: ${prediction.part_number || 'lookup manually'}
  Why: ${(prediction.reasoning || '').slice(0, 100)}
  Lookup: ${lookupUrl}
  Job: ${teddyToolUrl}
  Order pre-visit if confident.`;

  let smsResult;
  try { smsResult = await sms.toOwner(body, { call_site: 'parts_pre_order_suggestion' }); }
  catch (e) { smsResult = { ok: false, error: String(e) }; }

  try {
    await xano.recordEvent(dedupAction, {
      job_id: jobId,
      appliance, brand, model, symptom,
      prediction,
      sms_ok: !!(smsResult && smsResult.ok),
      sent_at_ms: Date.now(),
    });
  } catch (_) {}

  await xano.markSignalProcessed(signal.id, 'parts_pre_order_handled', {
    job_id: jobId,
    confidence: prediction.confidence_pct,
    failed_component: prediction.failed_component,
  });
  log('parts_pre_order_sent', { job_id: jobId, conf: prediction.confidence_pct });
  return { success: true, action: 'sent' };
}
