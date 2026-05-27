// Renders a weekly HTML digest of last 7 days for Teddy. Triggered by
// a scheduled fetch (operator can put on Netlify Scheduled Functions
// OR Mac Mini cron). Returns the HTML; sending via email requires
// SendGrid/SES integration (deferred).
//
// For now: operator opens the URL Friday 8am, gets the page, copies +
// pastes into email. Or just bookmarks for the weekly review.

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

exports.handler = async function (event) {
  let pulse = {}, todo = {}, leaderboard = [], unpaid = {};
  try {
    [pulse, todo, leaderboard, unpaid] = await Promise.all([
      fetch(`${XANO}/get_office_pulse?limit=20`).then(r => r.json()).catch(() => ({})),
      fetch(`${XANO}/get_office_todo`).then(r => r.json()).catch(() => ({})),
      fetch(`${XANO}/get_tech_leaderboard`).then(r => r.json()).then(d => d.leaderboard || []).catch(() => []),
      fetch(`${XANO}/get_unpaid_self_pay_jobs`).then(r => r.json()).catch(() => ({})),
    ]);
  } catch (err) {
    return { statusCode: 500, body: 'fetch failed: ' + err.message };
  }

  const headline = pulse.headline || {};
  const counts = todo.counts || {};
  const lbTop3 = leaderboard.sort((a,b) => (b.jobs_completed - a.jobs_completed) || (b.earnings_total - a.earnings_total)).slice(0, 3);

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Weekly Digest - ${new Date().toISOString().slice(0,10)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 720px; margin: 30px auto; padding: 18px; color: #1a1f2c; }
  h1 { font-size: 26px; }
  .sub { color: #6b7280; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0; }
  .stat { background: #f7f8fb; padding: 12px; border-radius: 8px; text-align: center; }
  .stat .lbl { font-size: 11px; color: #6b7280; text-transform: uppercase; }
  .stat .val { font-size: 20px; font-weight: 800; margin-top: 4px; }
  .section { margin: 24px 0; padding: 16px; background: #f7f8fb; border-radius: 8px; }
  .section h2 { font-size: 16px; margin-bottom: 12px; }
  .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
  .row:last-child { border-bottom: none; }
  .ant { font-size: 26px; }
</style></head>
<body>
  <div class="ant">🐜</div>
  <h1>Weekly Digest</h1>
  <p class="sub">Today: ${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</p>

  <div class="grid">
    <div class="stat"><div class="lbl">Today scheduled</div><div class="val">${headline.scheduled_today || 0}</div></div>
    <div class="stat"><div class="lbl">In progress</div><div class="val">${headline.in_progress || 0}</div></div>
    <div class="stat"><div class="lbl">Completed today</div><div class="val">${headline.completed_today || 0}</div></div>
    <div class="stat"><div class="lbl">Awaiting parts</div><div class="val">${headline.awaiting_parts || 0}</div></div>
  </div>

  <div class="section">
    <h2>Office todo</h2>
    <div class="row"><span>Stale intake (>3d)</span><strong>${counts.stale_intake || 0}</strong></div>
    <div class="row"><span>Held (warranty auth)</span><strong>${counts.held || 0}</strong></div>
    <div class="row"><span>Parts arrived</span><strong>${counts.parts_arrived || 0}</strong></div>
    <div class="row"><span>TDR-blocked attempts</span><strong>${counts.tdr_blocked || 0}</strong></div>
    <div class="row"><span>Callback alerts</span><strong>${counts.callbacks || 0}</strong></div>
  </div>

  <div class="section">
    <h2>Tech leaderboard (top 3 this month)</h2>
    ${lbTop3.map((t,i) => `
      <div class="row">
        <span>${['🥇','🥈','🥉'][i]} ${t.first_name} ${t.last_name}</span>
        <strong>${t.jobs_completed} jobs · $${Number(t.earnings_total || 0).toFixed(2)}</strong>
      </div>`).join('')}
  </div>

  <div class="section">
    <h2>Unpaid self-pay</h2>
    <div class="row"><span>Open count</span><strong>${(unpaid && unpaid.job_count) || 0}</strong></div>
  </div>

  <p style="margin-top:30px;color:#6b7280;font-size:12px">🐜 ANT · TN Appliance Exchange LLC</p>
</body></html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  };
};
