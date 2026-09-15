const m = require('../netlify/functions/platform-tn-parts-migrate.js');
const KEYS = m._OFFICE_OWNED;
let pass=0, fail=0;
function t(name, ok, extra){ if(ok){pass++;console.log('  ok  '+name);} else {fail++;console.log('  FAIL '+name+(extra?' :: '+JSON.stringify(extra):''));} }

// existing rows the office typed
const EXISTING = [
  { xano_id:'wp:123:ABC', number:'ABC', name:'Ice maker', source:'Marcone — pick up', ship_to:'shop', eta:'2026-09-20', disposition:'used', order_status:'ordered', cost_cents:4500, sell_cents:6000 },
  { xano_id:'po:9',       number:'W10',  name:null,        source:'Amazon',            ship_to:'customer', eta:null, disposition:null, order_status:null, cost_cents:null, sell_cents:null },
];
function mkDb(rows, opts){ opts=opts||{};
  global.fetch = async function(url){
    if(opts.throw) throw new Error('boom');
    return { ok:true, json: async()=> rows };
  };
  return m._pf('https://x.test','k');
}

(async function(){
  // 1) blank incoming must NOT wipe a typed value
  let db = mkDb(EXISTING);
  let row = { company_id:'c', job_id:'j', xano_id:'wp:123:ABC', number:null, name:null, source:null, order_status:null, disposition:null };
  let kept = await db.keepTypedParts([row], KEYS);
  t('blank source kept', row.source==='Marcone — pick up', row);
  t('blank name kept', row.name==='Ice maker', row);
  t('blank disposition kept', row.disposition==='used', row);
  t('kept count', kept===5, {kept});
  t('never ADDS a key (no ship_to)', !('ship_to' in row), Object.keys(row));
  t('never ADDS a key (no eta)', !('eta' in row), Object.keys(row));
  t('never ADDS a key (no cost_cents)', !('cost_cents' in row), Object.keys(row));

  // 2) a REAL Xano value still wins (system of record)
  db = mkDb(EXISTING);
  row = { xano_id:'wp:123:ABC', source:'Encompass', disposition:'return' };
  await db.keepTypedParts([row], KEYS);
  t('different non-empty Xano value wins (source)', row.source==='Encompass', row);
  t('different non-empty Xano value wins (disposition)', row.disposition==='return', row);

  // 3) money: null incoming keeps typed cost, real incoming wins
  db = mkDb(EXISTING);
  row = { xano_id:'wp:123:ABC', cost_cents:null, sell_cents:9900 };
  await db.keepTypedParts([row], KEYS);
  t('blank cost_cents kept', row.cost_cents===4500, row);
  t('real sell_cents wins', row.sell_cents===9900, row);

  // 4) existing is blank too -> stays blank, nothing invented
  db = mkDb(EXISTING);
  row = { xano_id:'po:9', name:null, eta:null };
  await db.keepTypedParts([row], KEYS);
  t('blank+blank stays null (name)', row.name===null, row);
  t('blank+blank stays null (eta)', row.eta===null, row);

  // 5) empty string counts as blank incoming
  db = mkDb(EXISTING);
  row = { xano_id:'wp:123:ABC', source:'   ' };
  await db.keepTypedParts([row], KEYS);
  t('whitespace-only incoming treated as blank', row.source==='Marcone — pick up', row);

  // 6) no existing row -> untouched
  db = mkDb(EXISTING);
  row = { xano_id:'wp:NEW:1', source:null };
  await db.keepTypedParts([row], KEYS);
  t('unknown xano_id untouched', row.source===null, row);

  // 7) guard must FAIL OPEN, never break the migrate
  db = mkDb(EXISTING, {throw:true});
  row = { xano_id:'wp:123:ABC', source:null };
  let k = await db.keepTypedParts([row], KEYS);
  t('fetch failure returns 0 and does not throw', k===0, {k});
  t('fetch failure leaves row as-is (today behavior)', row.source===null, row);

  console.log('\n'+pass+'/'+(pass+fail)+' passed');
  process.exit(fail?1:0);
})();
