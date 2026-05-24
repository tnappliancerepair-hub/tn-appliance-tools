import * as xano from '../xano.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else out[a.slice(2)] = argv[++i];
    }
  }
  return out;
}

const args = parseArgs(process.argv);
if (!args.type) {
  console.error('usage: node scripts/inject-signal.js --type=JOB_CREATED [--strength=50] [--payload=\'{"k":"v"}\'] [--source=manual]');
  process.exit(1);
}

let payload = {};
if (args.payload) {
  try { payload = JSON.parse(args.payload); }
  catch (err) { console.error('invalid --payload JSON:', err.message); process.exit(1); }
}

const r = await xano.emitSignal({
  signal_type: args.type,
  signal_strength: Number(args.strength) || 50,
  source_colony: args.source || 'manual-inject',
  payload,
});
console.log('emitted:', JSON.stringify(r));
