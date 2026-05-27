// Handles BLOG_POST_GENERATOR signals (emitted weekly Wed 9am CT).
// Asks Claude to write a 400-word repair-tips blog post on a rotating
// topic, writes to event_log. Future: auto-publish to a CMS or commit
// to /blog/ folder.
import { config } from '../config.js';

const TOPICS = [
  'Top 5 reasons a refrigerator stops cooling',
  'Why your dryer takes too long to dry — and what to check first',
  'Dishwasher not draining: 7 common causes and DIY fixes',
  'Washing machine won\'t spin: simple checks before calling a tech',
  'When to repair vs replace an appliance (real cost analysis)',
  'Home warranty pros + cons: what TN homeowners should know',
  'Gas range igniter clicking but not lighting: troubleshooting guide',
  'Refrigerator water dispenser slow: filter, valve, or line?',
  'Front-load washer mold smell: how to prevent and fix it',
  'Dryer vent cleaning: why it matters (and when to do it)',
];

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  const apiKey = config.anthropicApiKey;
  if (!apiKey) {
    await xano.markSignalProcessed(signal.id, 'blog_post_generator_handled', { outcome: 'skipped_no_api_key' });
    return { success: false, action: 'skipped_no_api_key' };
  }

  const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const topic = TOPICS[weekNum % TOPICS.length];

  let post = '';
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: 'You write friendly, helpful 350-450 word blog posts for a Middle TN + Southeast LA appliance repair company called TN Appliance Exchange. Use markdown. End with a soft CTA: "Need help? Call 615-280-2949 or get a quote at tnapplianceexchange.net/quote.html."',
        messages: [{ role: 'user', content: `Write a blog post titled: "${topic}"` }],
      }),
    });
    const data = await resp.json();
    post = String((data && data.content && data.content[0] && data.content[0].text) || '').trim();
  } catch (err) {
    log('blog_post_claude_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'blog_post_generator_handled', { outcome: 'claude_failed' });
    return { success: false, action: 'claude_failed' };
  }

  try {
    await xano.recordEventLog(`blog_post_generated_${weekNum}`, {
      week_num: weekNum,
      topic,
      char_count: post.length,
      post_preview: post.slice(0, 500),
      source_signal_id: signal.id,
    });
  } catch (e) { /* */ }

  const meta = { outcome: 'generated', topic, char_count: post.length };
  await xano.markSignalProcessed(signal.id, 'blog_post_generator_handled', meta);
  log('blog_post_generator_handled', meta);
  return { success: true, action: 'generated', topic, post };
}
