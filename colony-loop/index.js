import { config } from './config.js';
import * as xano from './xano.js';
import { tick } from './tick.js';

process.on('SIGTERM', () => {
  xano.logLocal('loop_shutdown', { signal: 'SIGTERM' });
  process.exit(0);
});

process.on('SIGINT', () => {
  xano.logLocal('loop_shutdown', { signal: 'SIGINT' });
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  xano.logLocal('unhandled_rejection', { reason: String(reason) });
});

xano.logLocal('loop_started', {
  colony: config.colonyName,
  tick_ms: config.tickMs,
  dry_run: config.dryRun,
  model: config.claudeModel,
  node: process.version,
});

tick();
setInterval(tick, config.tickMs);
