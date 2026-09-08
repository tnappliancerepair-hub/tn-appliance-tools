// ant-windows.js — THE arrival-window catalog for the platform. One definition, every
// surface. Drop <script src="/platform/ant-windows.js"></script> on any page that shows,
// picks, or counts a time window.
//
// Teddy 2026-09-08: "three separate time slots... 8 to 11, 11 to 2, 2 to 5 — two slots
// each... that way customers aren't waiting all day over confusion."
//
// Six stops a day per tech = 3 windows x 2 slots. The office schedules INTO a window and
// can see what's left; the customer can ask for one. Free-text availability stays — the
// window narrows the day, it doesn't replace "tell us when you're around".
//
// The window is a PROMISE, not a clock time. Never speak a precise minute to a customer —
// say the window. job.scheduled_start remains a routing placeholder and is not the truth.
(function (root) {
  var LIST = [
    { key: '8-11', label: '8–11 AM',    short: '8–11', hour: 8,  slots: 2 },
    { key: '11-2', label: '11 AM–2 PM', short: '11–2', hour: 11, slots: 2 },
    { key: '2-5',  label: '2–5 PM',     short: '2–5',  hour: 14, slots: 2 }
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

  // "8–11 AM · 1 of 2 left" / "8–11 AM · full" — what the office needs to decide at a glance.
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
    LIST: LIST, SLOTS_PER: 2, LEGACY: LEGACY,
    get: get, label: label, short: short, isWindow: isWindow,
    slotsFor: slotsFor, hourFor: hourFor,
    taken: taken, remaining: remaining, isFull: isFull,
    optionText: optionText, selectHtml: selectHtml, chipsHtml: chipsHtml
  };
})(window);
