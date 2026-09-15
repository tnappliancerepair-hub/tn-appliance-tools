// Andre's two asks, 2026-09-15: "can we add Apple Maps" and "an option for no parts needed
// for a stop which happens frequently" — plus Danielle's "Need a paid folder."
//
// All three are the same shape, and it is the shape this board keeps getting caught by:
// the capability is there (or trivially there) and the WORD the person uses is not, so to
// them the feature does not exist. The paid folder was literally already live, named
// "Shop Money Paid". Andre's "no parts needed" had to be left BLANK — and a blank field is
// indistinguishable from a field nobody filled in, so the office can't tell "he checked,
// nothing needed" from "he never answered".
//
// THE ANCHOR THAT MATTERS: the nav catalog is loaded as the REAL shipped file (a browser
// would run exactly these bytes), and the finish-status rule is regex-lifted out of the
// shipped tech page — so a future edit that sends a no-parts stop into Awaiting Parts fails
// here on purpose.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let pass = 0, fail = 0;
const eq = (l, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + l); }
  else { fail++; console.log('  FAIL ' + l + '\n         got  ' + a + '\n         want ' + b); }
};
const ok = (l, cond) => eq(l, !!cond, true);

// Load the shipped catalog the way a browser does, with a navigator we control.
const NAV_SRC = R('platform/ant-maps.js');
function loadNav(ua, platform) {
  const g = { navigator: { userAgent: ua, platform: platform } };
  new Function('window', NAV_SRC)(g);
  return g.AntMaps;
}
const iphone = loadNav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15', 'iPhone');
const ipad13 = loadNav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'MacIntel'); // iPadOS 13+ lies
const android = loadNav('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36', 'Linux armv8l');
const nothing = loadNav('', ''); // a UA we have never seen

const ADDR = '3137 Skinner Dr, Antioch, TN';

console.log('\nApple Maps exists, by name, and starts directions');
ok('appleUrl is maps.apple.com', iphone.appleUrl(ADDR).startsWith('https://maps.apple.com/'));
ok('appleUrl uses daddr so it navigates, not just drops a pin', iphone.appleUrl(ADDR).includes('?daddr='));
ok('the address is encoded (no raw spaces/commas)', !/[ ,]/.test(iphone.appleUrl(ADDR).split('daddr=')[1]));
eq('encoding round-trips to the real address',
  decodeURIComponent(iphone.appleUrl(ADDR).split('daddr=')[1]), ADDR);

console.log('\nGoogle is untouched — adding Apple Maps costs the Google techs nothing');
ok('googleUrl is still maps.google.com/?q=', android.googleUrl(ADDR).startsWith('https://maps.google.com/?q='));

console.log('\n⚠️ DETECTION MAY ONLY REORDER, NEVER REMOVE');
// This is the whole safety property. A tech in a driveway is the wrong place to find out a
// platform guess took his map away, so every device — including a UA we have never seen —
// must be handed BOTH maps, spelled out.
[['iPhone', iphone], ['iPadOS-13-as-Mac', ipad13], ['Android', android], ['unknown UA', nothing]]
  .forEach(([name, nav]) => {
    const h = nav.linksHtml(ADDR);
    ok(name + ' is offered Apple Maps', h.includes('Apple Maps'));
    ok(name + ' is offered Google Maps', h.includes('Google Maps'));
    ok(name + ' gets exactly two navigate links', (h.match(/<a /g) || []).length === 2);
  });

console.log('\n…and it does put the right one first');
ok('iPhone reads Apple Maps first', iphone.linksHtml(ADDR).indexOf('Apple Maps') < iphone.linksHtml(ADDR).indexOf('Google Maps'));
ok('an iPad reporting itself as a Mac still reads Apple first', ipad13.isApple());
ok('Android reads Google Maps first', android.linksHtml(ADDR).indexOf('Google Maps') < android.linksHtml(ADDR).indexOf('Apple Maps'));
ok('primaryUrl follows the device (iPhone → Apple)', iphone.primaryUrl(ADDR).includes('maps.apple.com'));
ok('primaryUrl follows the device (Android → Google)', android.primaryUrl(ADDR).includes('maps.google.com'));

console.log('\nno address → no dead link');
eq('blank address renders nothing at all', iphone.linksHtml(''), '');
eq('null address renders nothing at all', iphone.linksHtml(null), '');

console.log('\nevery surface that navigates reads the ONE catalog');
// The reason this catalog exists: six hardcoded maps.google.com links had already drifted
// across four pages. A seventh pasted back in fails here.
['platform/tech.html', 'platform/tech-job.html', 'platform/dispatch.html', 'platform/job-view.html']
  .forEach((p) => {
    const S = R(p);
    const name = path.basename(p);
    ok(name + ' loads ant-maps.js', S.includes('/platform/ant-maps.js'));
    ok(name + ' calls AntMaps', /AntMaps\.(linksHtml|primaryUrl)\(/.test(S));
    ok(name + ' keeps NO hardcoded Google link of its own', !S.includes('maps.google.com'));
  });

console.log('\n"no parts needed" is a thing a tech can actually say');
const TJ = R('platform/tech-job.html');
const TH = R('platform/tech.html');
ok('the tech day list offers it in the part-status picker', /pso\('none','[^']*No parts needed'\)/.test(TH));
ok('the job page offers it as a one-tap button', /data-ps="none">[^<]*No parts needed/.test(TJ));

console.log('\n…and saying it does NOT park the job in Awaiting Parts');
// Lifted out of the shipped job page — this is the rule Andre's tap actually hits.
const ruleLine = (TJ.match(/var ns=\(outcome===[^;]+;/) || [])[0] || '';
ok('lifted the finish-status rule out of the shipped page', ruleLine.length > 20);
const goesToParts = (outcome, partStatus) =>
  new Function('outcome', 'partStatus', ruleLine + ' return ns;')(outcome, partStatus) === 'awaiting_parts';
eq('no parts needed + fixed  → the job closes', goesToParts('fixed', 'none'), false);
eq('please order            → still Awaiting Parts', goesToParts('fixed', 'please_order'), true);
eq('missing part            → still Awaiting Parts', goesToParts('fixed', 'missing'), true);
eq('needs a return trip     → still Awaiting Parts', goesToParts('return_needed', 'none'), true);

console.log('\n…and the office can SEE he answered, instead of reading a blank');
ok("the report chip says 'no parts needed' when he picked it",
  /part_status==='none'\?[^:]*no parts needed/.test(TH));

console.log('\nDanielle can find the paid folder by its name');
const OB = R('platform/office-board.html');
const paidCol = (OB.match(/\{ key:'shop_paid',[^}]*\}/) || [])[0] || '';
ok('lifted the shop_paid column out of the shipped board', paidCol.length > 10);
ok('the column is labelled with the word she uses: Paid', /label:'[^']*Paid'/.test(paidCol));
// (the old name still appears once, in the comment above the column, as the record of why —
// so this checks the LABEL the office actually reads, not the file's bytes.)
ok('it no longer calls itself Shop Money Paid', !/label:'Shop Money Paid'/.test(OB));
ok('the key is still shop_paid, so nothing parked there moves', paidCol.includes("key:'shop_paid'"));

console.log('\n⚠️ ant-nav.js is the TECH APP SHELL — not a maps file');
// I clobbered this file writing the maps catalog: `cat > platform/ant-nav.js` silently
// replaced the shared tab bar (My Day · Pay · Stats · More) that tech.html and tech-job.html
// load, which would have deleted the tech app's entire bottom navigation. The maps catalog
// lives in ant-maps.js. This asserts the two never trade places again.
const NAVSHELL = R('platform/ant-nav.js');
ok('ant-nav.js still injects the tech tab bar', /class *= *'tabbar'|className *= *'tabbar'/.test(NAVSHELL));
ok('ant-nav.js still carries the My Day tab', NAVSHELL.includes("'My Day'"));
ok('ant-nav.js is NOT the maps catalog', !/AntMaps|maps\.apple\.com/.test(NAVSHELL));
ok('ant-maps.js is NOT the app shell', !/tabbar|My Day/.test(NAV_SRC));
['platform/tech.html', 'platform/tech-job.html'].forEach((p) => {
  ok(path.basename(p) + ' still loads the tech app shell', R(p).includes('/platform/ant-nav.js'));
});
['platform/dispatch.html', 'platform/job-view.html'].forEach((p) => {
  ok(path.basename(p) + ' does NOT get a tech tab bar', !R(p).includes('/platform/ant-nav.js'));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
