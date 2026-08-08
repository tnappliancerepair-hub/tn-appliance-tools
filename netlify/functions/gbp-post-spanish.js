// gbp-post-spanish.js — publishes Spanish Google Business Profile posts on a
// rotation, several times a week. ONE profile (no per-language duplicate listings
// — that's a Google violation); this just adds genuine Spanish content to it, and
// posts don't have to match the profile language.
//
// Fast + cheap by design: a hand-written POOL of "common sense" Spanish posts
// (zero per-post AI cost, quality-controlled). Each run picks the pool item used
// LEAST recently, so it cycles through all of them before repeating (~4 weeks at
// 3/week). Each points its Book button at the right Spanish page.
//
//   (scheduled — Mon/Wed/Fri — publishes automatically)
//   GET ?dryrun=1                 preview the next post, write nothing
//   GET ?secret=<admin>&publish=1 publish one now (manual)
// Kill switch: vault GBP_SPANISH_POSTS=false.
'use strict';
const gbp = require('./_lib/gbp');
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

const SITE = 'https://tnapplianceexchange.net';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

// The rotation. Warm, helpful, honest — "help the people who need our help."
// body = post text (Book button + URL added by GBP); url = where Book points.
// NOTE: NO phone numbers in the body. Google's Local Post policy rejects posts
// that put contact info (phone) in the text — that's what was killing every
// Spanish post (all live English posts have no phone → they pass). The Book
// button + the profile already carry the contact path, so each post ends with a
// natural Spanish call-to-action instead of a phone number.
const POOL = [
  { id: 'quickcheck', url: SITE + '/es/', body: '¿Se te descompuso un electrodoméstico? 🔧 Te ayudamos — atención en español. Con la Revisión Rápida de $50 envías un video corto y una foto del número de modelo, y un técnico de verdad te dice qué está mal y tus opciones. Los $50 se acreditan a tu reparación. Toca Reservar y empezamos.' },
  { id: 'diy', url: SITE + '/es/fix/', body: '¿Prefieres arreglarlo tú mismo? 💪 Tenemos guías honestas y gratis en español para los problemas más comunes — lavadora, secadora, refrigerador, lavavajillas, estufa y más. Te decimos qué revisar con seguridad y si vale la pena repararlo. Y si necesitas un técnico, aquí estamos.' },
  { id: 'dryer-fire', url: SITE + '/es/fix/dryer-not-heating.html', body: '🔥 ¿Tu secadora tarda dos o tres ciclos en secar? Casi siempre es el ducto tapado — y también es la causa #1 de incendios de secadora. Limpiarlo hace que seque más rápido y previene un riesgo real. Te decimos cómo, o lo hacemos por ti. Toca Reservar para agendar.' },
  { id: 'fridge', url: SITE + '/es/fix/refrigerator-not-cooling.html', body: '🧊 ¿Tu refrigerador funciona pero no enfría? Antes de pensar en lo peor: muchas veces son los serpentines sucios o un ventilador — un arreglo económico, no el compresor. Aspira los serpentines y mira si mejora. ¿Sigue tibio? Un técnico real te da una respuesta honesta.' },
  { id: 'washer-drain', url: SITE + '/es/fix/washer-wont-drain.html', body: '🌀 ¿Tu lavadora deja el agua adentro? Casi siempre es el filtro de la bomba tapado — a menudo un arreglo de 10 minutos. Desconéctala, abre el filtro abajo al frente y límpialo. Te mostramos cómo, o lo resolvemos rápido. Atención en español.' },
  { id: 'ice', url: SITE + '/es/fix/no-hace-hielo.html', body: '❄️ ¿La fábrica de hielo dejó de hacer hielo? Lo más común: el filtro de agua vencido (cámbialo cada ~6 meses), una línea de agua doblada, o un congelador que no está a 0 °F. Son revisiones simples que puedes hacer hoy. ¿Necesitas ayuda? Toca Reservar.' },
  { id: 'dishwasher', url: SITE + '/es/fix/lavavajillas-no-limpia.html', body: '🍽️ ¿El lavavajillas deja los platos sucios? Casi siempre es el filtro del fondo — límpialo una vez al mes y notarás la diferencia. También ayuda destapar los brazos aspersores y abrir el agua caliente antes de iniciar. Te lo explicamos en español, o lo revisamos por ti.' },
  { id: 'always-on', url: SITE + '/es/', body: '📱 ¿Se te dañó algo un domingo o a media noche? No hay problema — respondemos a cualquier hora. Escríbenos cuando te quede bien y te contestamos rápido, en español. Reparación de electrodomésticos honesta, familia desde 2012.' },
  { id: 'honest', url: SITE + '/es/', body: '💬 Te decimos la verdad: no todo vale la pena repararlo. Con la Revisión Rápida de $50 un técnico real revisa tu video y te da la comparación honesta de reparar vs. reemplazar antes de que gastes de más. Sin sorpresas, en español.' },
  { id: 'gas-stove', url: SITE + '/es/fix/estufa-gas-no-enciende.html', body: '🔥 ¿El quemador de tu estufa de gas hace clic pero no prende? Muchas veces las piezas quedaron húmedas o mal puestas después de limpiar, o el encendedor está tapado. Te decimos qué es seguro revisar tú mismo — y qué dejar a un profesional. (Si hueles a gas, sal y llama a tu compañía de gas.)' },
  { id: 'washer-hoses', url: SITE + '/es/fix/lavadora-pierde-agua.html', body: '💧 Consejo que evita un desastre: revisa las mangueras de tu lavadora. Las de goma se agrietan con los años y son una causa común de inundaciones caseras — cámbialas cada 3 a 5 años. Nosotros las revisamos y reemplazamos. Atención en español.' },
  { id: 'microwave', url: SITE + '/es/fix/microondas-no-calienta.html', body: '📻 ¿Tu microondas enciende pero no calienta? ⚠️ Nunca lo abras tú mismo — guarda un voltaje peligroso aun desconectado. Pero sí puedes confirmar que no esté en modo temporizador y con la potencia al 100%. Si de verdad no calienta, es trabajo de técnico. Te ayudamos en español.' },
];

async function pickNext() {
  let recent = [];
  try {
    const rows = await crud.searchPage(3, { action: 'gbp_post_published' }, { id: 'desc' }, 24);
    recent = (rows || []).map(metaOf).filter((m) => m.topic === 'es_pool' && m.pool_id).map((m) => m.pool_id);
  } catch (_) { recent = []; }
  // first pool item not used in recent history
  const fresh = POOL.find((p) => !recent.includes(p.id));
  if (fresh) return fresh;
  // all used recently → pick the one used longest ago (last in the recent list)
  const oldestId = recent[recent.length - 1];
  return POOL.find((p) => p.id === oldestId) || POOL[0];
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const dry = q.dryrun === '1';
  const manual = q.publish === '1';
  if (manual) {
    const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  }
  if (String(await getSecret('GBP_SPANISH_POSTS') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });
  if (!(await gbp.isConfigured())) return json(200, { ok: false, error: 'gbp not configured' });

  // ?id=<pool_id> forces a specific post (manual/admin only); else rotation.
  const forced = (q.id || '').trim() ? POOL.find((p) => p.id === q.id.trim()) : null;
  const post = forced || await pickNext();
  if (dry) return json(200, { ok: true, mode: 'dryrun', pool_id: post.id, url: post.url, post: post.body });

  const r = await gbp.createLocalPost({ summary: post.body, actionType: 'BOOK', actionUrl: post.url });
  if (r.ok) { try { await crud.logEvent('gbp_post_published', { topic: 'es_pool', pool_id: post.id, url: post.url, post_name: (r.data && r.data.name) || '', manual: !!manual, at_ms: Date.now() }); } catch (_) {} }
  return json(200, { ok: r.ok, mode: manual ? 'manual_publish' : 'scheduled_publish', pool_id: post.id, url: post.url, published: r.ok, post_name: (r.data && r.data.name) || null, status: r.status, error: r.ok ? undefined : r.data });
};
