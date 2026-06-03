#!/usr/bin/env node
// vapi-diff — compare local vapi-config files against live Vapi state.
// Highlights what would change on a push.

const fs = require('fs');
const path = require('path');
const vapi = require('../vapi-config/_lib/vapi-client');

const ROOT = path.join(__dirname, '..', 'vapi-config');

function listJsonFiles(dir) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(full, f));
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function deepDiff(local, remote, prefix = '') {
  const changes = [];
  const localKeys = new Set(Object.keys(local || {}));
  const remoteKeys = new Set(Object.keys(remote || {}));
  const all = new Set([...localKeys, ...remoteKeys]);
  const skip = new Set(['id', 'createdAt', 'updatedAt', 'orgId']);
  for (const k of all) {
    if (skip.has(k)) continue;
    const lk = `${prefix}${k}`;
    if (!localKeys.has(k)) {
      changes.push(`  - ${lk} (in remote only)`);
    } else if (!remoteKeys.has(k)) {
      changes.push(`  + ${lk} (in local only)`);
    } else {
      const lv = local[k]; const rv = remote[k];
      if (typeof lv === 'object' && lv !== null && typeof rv === 'object' && rv !== null && !Array.isArray(lv)) {
        changes.push(...deepDiff(lv, rv, `${lk}.`));
      } else if (JSON.stringify(lv) !== JSON.stringify(rv)) {
        const ls = JSON.stringify(lv).slice(0, 60);
        const rs = JSON.stringify(rv).slice(0, 60);
        changes.push(`  ~ ${lk}: ${rs} → ${ls}`);
      }
    }
  }
  return changes;
}

async function diffCategory(category, fetcher) {
  console.log(`\n=== ${category} ===`);
  const remoteList = await fetcher();
  const items = Array.isArray(remoteList) ? remoteList : (remoteList.results || []);
  const remoteById = new Map(items.map((x) => [x.id, x]));
  const seenIds = new Set();

  for (const localFile of listJsonFiles(category)) {
    const local = readJson(localFile);
    const rel = path.relative(ROOT, localFile);
    if (!local.id) {
      console.log(`+ ${rel} (new — will POST)`);
      continue;
    }
    seenIds.add(local.id);
    const remote = remoteById.get(local.id);
    if (!remote) {
      console.log(`! ${rel} (id ${local.id} not found in Vapi — was it deleted?)`);
      continue;
    }
    const changes = deepDiff(local, remote);
    if (changes.length === 0) {
      console.log(`= ${rel} (no changes)`);
    } else {
      console.log(`~ ${rel}:`);
      changes.slice(0, 20).forEach((c) => console.log(c));
      if (changes.length > 20) console.log(`  ... ${changes.length - 20} more`);
    }
  }

  for (const [id, remote] of remoteById) {
    if (!seenIds.has(id)) {
      console.log(`- (no local file) ${remote.name || id} — exists in Vapi but not in repo`);
    }
  }
}

(async () => {
  await diffCategory('tools', () => vapi.listTools());
  await diffCategory('assistants', () => vapi.listAssistants());
  await diffCategory('phone-numbers', () => vapi.listPhoneNumbers());
  try {
    await diffCategory('squads', () => vapi.listSquads());
  } catch (e) {
    console.log('\n=== squads === (skipped: ' + e.message.slice(0, 60) + ')');
  }
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
