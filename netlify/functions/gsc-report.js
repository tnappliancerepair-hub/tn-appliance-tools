// gsc-report — on-demand read of the weekly SEO / indexing tracker.
//
// gsc-weekly-report is a SCHEDULED function, and Netlify blocks manual HTTP to
// scheduled functions (403) — so "pull the indexing count anytime" broke there.
// This NON-scheduled companion restores it: reads the latest stored snapshot(s),
// and with &live=1 recomputes NOW (and writes a fresh snapshot so the next weekly
// run has a clean week-over-week delta to show). Mirrors phone-score.js.
//
//   GET ?secret=<admin>            -> latest stored indexing + language numbers + delta
//   GET ?secret=<admin>&live=1     -> recompute now, write a snapshot, return the digest
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const wk = require('./gsc-weekly-report');
const { getSecret } = require('./_lib/secrets');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(403, { ok: false, error: 'forbidden — ?secret=<admin>' });

  let snaps = [];
  try { snaps = await crud.searchPage(crud.TABLES.event_log, { action: wk.ACTION }, { id: 'desc' }, 2); } catch (_) {}
  const latest = snaps[0] ? meta(snaps[0]) : null;
  const prior = snaps[1] ? meta(snaps[1]) : null;

  const out = {
    ok: true,
    latest: latest ? { date: latest.date, indexed_pages: latest.pages && latest.pages.surfacing, page1: latest.pages && latest.pages.page1, new_language: latest.langs || null } : null,
    prior: prior ? { date: prior.date, indexed_pages: prior.pages && prior.pages.surfacing, page1: prior.pages && prior.pages.page1, new_language: prior.langs || null } : null,
    note: latest ? undefined : 'No snapshot yet — call with &live=1 to create the first one.',
  };

  if (q.live === '1') {
    try {
      // Sequential (avoid hammering the GSC API) — each query is ~1-3s.
      const curRows = await wk.buildCurrent();
      const pages = await wk.buildPages();
      const langs = await wk.buildLanguages();
      const prevMap = latest ? wk.posMap(latest) : {};
      const movement = wk.diff(curRows, prevMap);
      const digest = wk.smsDigest(movement, pages, latest ? latest.pages : null, langs, latest ? latest.langs : null);
      // Write a fresh snapshot so the next weekly run has a real delta to diff.
      try { await crud.logEvent(wk.ACTION, { date: wk.todayCT(), rows: curRows, pages, langs }); } catch (_) {}
      out.live = { indexed_pages: pages && pages.surfacing, page1: pages && pages.page1, new_language: langs, digest };
    } catch (e) { out.live_error = String((e && e.message) || e); }
  }

  return json(200, out);
};
