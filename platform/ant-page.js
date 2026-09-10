// ant-page.js — AntPage.all(makeQuery): fetch EVERY row, not the first 1,000.
//
// PostgREST caps a response server-side (max-rows = 1000 on this project) no matter what
// .limit() asks for, and it does NOT error — it quietly hands back less. Measured live
// 2026-09-10 on the real board query:
//
//     GET /rest/v1/job?status=not.in.(completed,canceled)&limit=2000
//     -> content-range: 0-999/1210          1,000 rows returned, 1,210 exist
//
// So .limit(2000) / .limit(3000) / .limit(10000) throughout the platform were reading as
// "give me everything" while silently dropping the tail. Measured damage the day this shipped:
// dispatch + needs-scheduled missing 210 of 1,210 open jobs, and owner.html computing
// take-home, first-stop rate and parts margin on 1,000 of 3,455 jobs.
//
// Same family as the office board showing 37 of 1,725 message threads. Any .select() that
// COULD exceed 1,000 rows needs this, an RPC, or an explicit count check — a plain .limit()
// bigger than the cap is a silent lie.
//
//   AntPage.all(function(){ return sb.from('job').select('…').not('status','in','(…)'); })
//     -> Promise<{ data, error, pages, partial }>
//
// Takes a FACTORY, not a query: a supabase-js builder can only be awaited once, so each page
// needs a fresh one. Response shape matches a normal query so call sites keep reading .data.
(function () {
  var PAGE = 1000;

  function all(makeQuery, opts) {
    opts = opts || {};
    var pageSize = opts.pageSize || PAGE;
    var maxPages = opts.maxPages || 25;          // 25k rows — a runaway guard, not a budget
    var label = opts.label || 'query';
    // .range() over an UNORDERED result can skip or duplicate rows between pages — Postgres
    // makes no ordering promise without ORDER BY. Applied here so no call site can forget.
    var orderCol = opts.orderBy || 'id';
    var rows = [];

    function fetchPage(page, attempt) {
      var from = page * pageSize;
      return makeQuery().order(orderCol, { ascending: true }).range(from, from + pageSize - 1).then(function (r) {
        if (r && r.error) throw r.error;
        return (r && r.data) || [];
      }).catch(function (e) {
        // One retry, mirroring the server-side pagers. A page lost after that is REPORTED,
        // never treated as end-of-table — that mistake is how a whole status silently
        // disappeared from the mirror.
        if (!attempt) return fetchPage(page, 1);
        throw e;
      });
    }

    function step(page) {
      return fetchPage(page, 0).then(function (got) {
        rows = rows.concat(got);
        if (got.length < pageSize) return { data: rows, error: null, pages: page + 1, partial: false };
        if (page + 1 >= maxPages) {
          if (window.console) console.warn('[AntPage] ' + label + ': stopped at maxPages (' + maxPages + ') — result may be short');
          return { data: rows, error: null, pages: page + 1, partial: true };
        }
        return step(page + 1);
      });
    }

    return step(0).catch(function (e) {
      // Loud on loss. Hand back what we have so the page still renders, but say plainly that
      // it is incomplete so a caller can surface it rather than quietly showing a short list.
      if (window.console) console.error('[AntPage] ' + label + ' failed after retry — showing ' + rows.length + ' row(s), INCOMPLETE', e);
      return { data: rows, error: e, pages: -1, partial: true };
    });
  }

  window.AntPage = { all: all, PAGE: PAGE };
})();
