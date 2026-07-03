// ant-job-tile.js — the ONE universal job tile, shared across every office board
// so a job looks + reads the same everywhere (Teddy 2026-07-03: "one universal
// tile for all of them, not five separate hand-coded ones").
//
// Drop <script src="/ant-job-tile.js"></script> on a page, then use:
//   AntJobTile.status(job)     -> { key, label, icon, bg, fg, bd }  (the data)
//   AntJobTile.statusPill(job) -> ready-to-drop HTML for the live status pill
//
// v1 is the live LIFECYCLE STATUS PILL — the thing Teddy wanted off the separate
// "Crew Today" page and onto the tiles: you glance at any board and see who's on
// the way, who's working, what's done, what's stuck on parts. More of the tile
// (the info block, actions, tap-to-open-the-drawer) folds in here next so every
// board shares one renderer.
(function () {
  'use strict';
  function num(v) { return Number(v) || 0; }
  function low(v) { return String(v == null ? '' : v).toLowerCase(); }
  var PARTS = /await|order|pending|needed|backorder|on.?order/;

  // The lifecycle, resolved most-advanced-first. Robust to missing fields: reads
  // en-route / started timestamps if the feed has them (it will once the board's
  // data includes tech_en_route_at / job_started_at), else falls back to status.
  function status(job) {
    job = job || {};
    var ss = low(job.scheduling_status), cs = low(job.current_status), ps = low(job.parts_status);
    var canceled = ss === 'canceled' || ss === 'cancelled' || cs === 'canceled';
    var done = ss === 'completed' || cs === 'completed' || num(job.job_completed_at) > 0;
    var started = ss === 'in_progress' || cs === 'in_progress' || num(job.job_started_at) > 0;
    var enroute = num(job.tech_en_route_at) > 0 || num(job.eta_ms) > 0 || /en.?route|on.?the.?way/.test(cs);
    var partsWait = ss === 'awaiting_parts' || PARTS.test(ps);
    var scheduled = ss === 'scheduled' || num(job.scheduled_start) > 0;

    if (canceled)  return { key: 'canceled',      label: 'Canceled',         icon: '🚫', bg: '#fdece9', fg: '#c0392b', bd: '#f3c0b7' };
    if (done)      return { key: 'completed',      label: 'Completed',        icon: '🏁', bg: '#e7f6ec', fg: '#0a7d33', bd: '#7fd3a3' };
    if (started)   return { key: 'in_progress',    label: 'In progress',      icon: '🔧', bg: '#fff4e0', fg: '#b3690a', bd: '#f3d49a' };
    if (enroute)   return { key: 'en_route',       label: 'On the way',       icon: '🚗', bg: '#e6f7ef', fg: '#0a7d4a', bd: '#9fe0bd' };
    if (partsWait) return { key: 'waiting_parts',  label: 'Waiting parts',    icon: '📦', bg: '#eaf2ff', fg: '#1559c9', bd: '#b9d4f5' };
    if (scheduled) return { key: 'scheduled',      label: 'Scheduled',        icon: '📅', bg: '#eef2f7', fg: '#41506a', bd: '#d7dde6' };
    return           { key: 'unscheduled',    label: 'Needs scheduling', icon: '⚪', bg: '#f3f4f6', fg: '#6b7280', bd: '#e1e5eb' };
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function statusPill(job) {
    var s = status(job);
    return '<span class="ant-jt-status" data-status="' + s.key + '" '
      + 'style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;'
      + 'font:800 11px/1 system-ui,-apple-system,sans-serif;letter-spacing:.03em;white-space:nowrap;'
      + 'background:' + s.bg + ';color:' + s.fg + ';border:1px solid ' + s.bd + '">'
      + s.icon + ' ' + esc(s.label.toUpperCase()) + '</span>';
  }

  window.AntJobTile = { status: status, statusPill: statusPill };
})();
