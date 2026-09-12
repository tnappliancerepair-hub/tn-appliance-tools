// Thin scheduled wrapper. The logic lives in deploy-watch.js so it stays curl-testable:
// a function that carries its own `schedule` block returns an edge 403 on any manual
// HTTP call, which would make the watcher impossible to verify by hand.
const { runWatch } = require('./deploy-watch');

exports.handler = async () => {
  try { const r = await runWatch({}); return { statusCode: 200, body: r.body }; }
  catch (e) { return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) }; }
};
