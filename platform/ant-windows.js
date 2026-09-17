// ant-windows.js — THE arrival-window catalog for the platform. One definition, every
// surface. Drop <script src="/platform/ant-windows.js"></script> on any page that shows,
// picks, or counts a time window.
//
// Teddy 2026-09-08: "three separate time slots... 8 to 11, 11 to 2, 2 to 5 — two slots
// each... that way customers aren't waiting all day over confusion."
//
// The office schedules INTO a window and can see what's left; the customer can ask for one.
// Free-text availability stays — the window narrows the day, it doesn't replace "tell us
// when you're around".
//
// SLOTS PER WINDOW = 3 (2026-09-10). It shipped at 2, and the real days disagreed. Measured
// across 166 tech-days over 45 days on TN's own board:
//
//     1 stop  11.4% |  2  13.3% |  3  12.0% |  4  25.9% |  5  16.9%
//     6 stops 10.2% |  7   7.8% |  8   1.8% | 10   0.6%
//
// Two-per-window caps a tech at 6, which is ONE IN TEN real days over the line — and the
// board deliberately lets a full window be chosen anyway, so "2" was never a cap, just a
// wrong number on the office's screen. Three per window (9/day) covers 99.4% of days, so
// the count now tells the truth and "full" starts meaning something.
//
// Change it HERE and every surface follows — the whole point of one catalog.
//
// The window is a PROMISE, not a clock time. Never speak a precise minute to a customer —
// say the window. job.scheduled_start remains a routing placeholder and is not the truth.
(function (root) {
  var LIST = [
    { key: '8-11', label: '8–11 AM',    short: '8–11', hour: 8,  slots: 3 },
    { key: '11-2', label: '11 AM–2 PM', short: '11–2', hour: 11, slots: 3 },
    { key: '2-5',  label: '2–5 PM',     short: '2–5',  hour: 14, slots: 3 }
  ];
  var BY = {}; LIST.forEach(function (w) { BY[w.key] = w; });

  // Offers made before the windows existed used am/pm/any. Keep them readable forever.
  var LEGACY = { am: 'mornings', pm: 'afternoons', any: 'anytime' };

  function get(key) { return BY[String(key || '')] || null; }
  function label(key) { var w = get(key); return w ? w.label : (LEGACY[String(key || '')] || ''); }
  function short(key) { var w = get(key); return w ? w.short : (LEGACY[String(key || '')] || ''); }
  function isWindow(key) { return !!get(key); }
  function slotsFor(key) { var w = get(key); return w ? w.slots : 0; }
  function hourFor(key) { var w = get(key); return w ? w.hour : null; }

  // ── DAY ORDER ──────────────────────────────────────────────────────────────────
  // Lee, 2026-09-17: "my schedule is all out of order -- it should start with the earlier
  // jobs and end with the later ones." He was right. Both the day list and the board ran a
  // tech's day through a nearest-neighbour ZIP sweep, which is a fact about the MAP and
  // says nothing about the clock -- so an 8-11 stop rendered fourth and an 11-2 stop first.
  //
  // THE RULE: the window is what the customer was TOLD, so it is the primary key. The
  // route is only an optimisation and only gets to reorder stops that SHARE a window.
  // A day runs by the clock; the map breaks ties.

  // Read an ISO timestamp as an hour on the CENTRAL clock (fractional, so 11:05 -> 11.08
  // sorts after 11:00). Central by construction -- reading it in UTC would put an evening
  // stop on tomorrow, the documented off-by-one that keeps biting this codebase.
  function hourOfIsoCT(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(d);
      var h = null, m = 0;
      parts.forEach(function (x) {
        if (x.type === 'hour') h = parseInt(x.value, 10);
        if (x.type === 'minute') m = parseInt(x.value, 10);
      });
      if (h == null || isNaN(h)) return null;
      if (h === 24) h = 0;                       // some engines render midnight as 24
      return h + (isNaN(m) ? 0 : m) / 60;
    } catch (e) { return null; }
  }

  // The VENDOR's window is free text and most of it is not a time of day at all --
  // "48 hours/2 business days" is a turnaround promise. Only read it when it genuinely
  // names a clock time, and never let an SLA phrase through.
  function parseWindowText(txt) {
    var s = String(txt || '').toLowerCase();
    if (!s.trim()) return null;
    if (/\b(hours?|business\s*days?|days?|weeks?|asap)\b/.test(s)) return null;  // an SLA, not a clock
    s = s.replace(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g, ' ');                  // drop a leading date
    var m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|\u2013|\u2014|to)\s*\d/);
    if (!m) return null;
    var h = parseInt(m[1], 10), mins = parseInt(m[2] || '0', 10);
    if (isNaN(h) || h > 23 || h < 0) return null;
    if (isNaN(mins) || mins > 59) mins = 0;
    var mer = (m[3] || '').replace(/[^ap]/g, '');
    if (h >= 13) return h + mins / 60;                       // already an unambiguous 24h clock
    if (mer === 'p') { if (h !== 12) h += 12; }
    else if (mer === 'a') { if (h === 12) h = 0; }
    else if (h >= 1 && h <= 6) { h += 12; }                  // a service day runs ~7am-7pm: 1-6 means afternoon
    return h + mins / 60;
  }

  // What hour does this job start at? Best honest signal first:
  //   1. time_window    -- the promise the office picked and the customer heard
  //   2. scheduled_start -- the booked timestamp, read on the Central clock
  //   3. service_window  -- the vendor's words, ONLY when they name a real clock time
  //   4. null            -- genuinely unknown; sorts AFTER everything that has a time
  // Measured on TN's 44 upcoming assigned jobs: (1) and (2) agree on 42. On the 2 that
  // disagree the customer heard the time_window, so it wins.
  function startHourFor(job) {
    if (!job) return null;
    var w = get(job.time_window);
    if (w) return w.hour;
    var h = hourOfIsoCT(job.scheduled_start);
    if (h != null) return h;
    return parseWindowText(job.service_window);
  }

  // Order ONE day's stops. Groups by start hour, runs the groups earliest-first, and lets
  // routeFn cluster by area only INSIDE a group. A stop with no time at all lands after
  // every stop that has one -- it must never jump ahead of a promised 8am.
  //   routeFn — the caller's route heuristic, applied within a window (optional)
  //   hourOf  — override the key; the tech app folds several machines at one address into
  //             one stop and passes that stop's earliest hour (optional)
  function orderDay(jobs, opts) {
    opts = opts || {};
    var routeFn = typeof opts.routeFn === 'function' ? opts.routeFn : null;
    var hourOf = typeof opts.hourOf === 'function' ? opts.hourOf : startHourFor;
    var buckets = [], byHour = {};
    (jobs || []).forEach(function (j) {
      var h = hourOf(j);
      var k = (h == null) ? '~' : String(h);
      if (!byHour[k]) { byHour[k] = { hour: h, jobs: [] }; buckets.push(byHour[k]); }
      byHour[k].jobs.push(j);
    });
    buckets.sort(function (a, b) {
      if (a.hour == null && b.hour == null) return 0;
      if (a.hour == null) return 1;
      if (b.hour == null) return -1;
      return a.hour - b.hour;
    });
    var out = [];
    buckets.forEach(function (b) { out = out.concat(routeFn ? routeFn(b.jobs) : b.jobs); });
    return out;
  }

  // How many of a window's slots are already spoken for, given the jobs already on that
  // tech's day. Pass the jobs you already have — this never queries.
  function taken(jobs, key, excludeJobId) {
    var n = 0;
    (jobs || []).forEach(function (j) {
      if (!j || String(j.time_window || '') !== String(key)) return;
      if (excludeJobId && String(j.id) === String(excludeJobId)) return;   // moving a job doesn't block itself
      var st = String(j.status || '');
      if (st === 'canceled') return;
      n++;
    });
    return n;
  }
  function remaining(jobs, key, excludeJobId) {
    return Math.max(0, slotsFor(key) - taken(jobs, key, excludeJobId));
  }
  function isFull(jobs, key, excludeJobId) { return remaining(jobs, key, excludeJobId) <= 0; }

  // "8–11 AM · 1 of 3 left" / "8–11 AM · full" — what the office needs to decide at a glance.
  function optionText(jobs, key, excludeJobId) {
    var left = remaining(jobs, key, excludeJobId);
    return label(key) + ' · ' + (left ? left + ' of ' + slotsFor(key) + ' left' : 'full');
  }

  // A <select> of the three windows, marked with what's left. Full windows stay CHOOSABLE —
  // the office overrides capacity all the time and shouldn't have to fight the app to do it.
  function selectHtml(id, current, jobs, excludeJobId, opts) {
    opts = opts || {};
    var out = '<select id="' + id + '">';
    if (opts.allowBlank !== false) {
      out += '<option value=""' + (current ? '' : ' selected') + '>' + (opts.blankLabel || 'No window yet') + '</option>';
    }
    LIST.forEach(function (w) {
      var sel = String(current || '') === w.key ? ' selected' : '';
      out += '<option value="' + w.key + '"' + sel + '>' + optionText(jobs, w.key, excludeJobId) + '</option>';
    });
    return out + '</select>';
  }

  // Plain chips for the customer — no capacity counts, they don't need our load.
  function chipsHtml(cls, current) {
    return LIST.map(function (w) {
      return '<button type="button" class="' + (cls || 'winchip') + (String(current || '') === w.key ? ' on' : '') +
        '" data-win="' + w.key + '">' + w.label + '</button>';
    }).join('');
  }

  root.AntWindows = {
    LIST: LIST, SLOTS_PER: 3, LEGACY: LEGACY,
    get: get, label: label, short: short, isWindow: isWindow,
    slotsFor: slotsFor, hourFor: hourFor,
    taken: taken, remaining: remaining, isFull: isFull,
    startHourFor: startHourFor, orderDay: orderDay,
    hourOfIsoCT: hourOfIsoCT, parseWindowText: parseWindowText,
    optionText: optionText, selectHtml: selectHtml, chipsHtml: chipsHtml
  };
})(window);
