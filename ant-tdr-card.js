// ant-tdr-card.js — the unified TDR surface.
//
// Auto-injects a floating "TDR" button (bottom-right) on any page that
// has a job_id in the URL. Tap opens a modal sheet showing the current
// state of the TDR: filled fields, blocking fields, photo count,
// warranty readiness percentage, role-appropriate actions.
//
// ONE include per page:   <script src="/ant-tdr-card.js" defer></script>
// No manual placeholder needed.
//
// Role auto-detection (used to filter actions, not field visibility):
//   tech-simple / tech-ant-chat / tech-daily-dashboard → 'tech'
//   customer-portal                                     → 'customer'
//   warranty-review / job-detail / teddy-tdr-tool       → 'office'
//   anything else                                       → 'office' (default)
(function () {
  if (window.__ANT_TDR_CARD_LOADED__) return;
  window.__ANT_TDR_CARD_LOADED__ = true;

  var XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
  var POLL_MS = 6000;
  var jobId = null;
  var techId = null;
  var role = 'office';
  var lastData = null;
  var pollTimer = null;
  var editKey = null; // when a field is being edited inline, don't let polling clobber it
  var _rec = null, _chunks = [], recordingNow = false; // in-app voice for the one-box
  // Vendor-supplied parts (warranty jobs): the parts SquareTrade/ServicePower SHIPPED for
  // this job, pulled from the parts emails. The tech marks each Used / Return / Not here —
  // that decision drives the return-tracking AND the claim's "returned" field. (Teddy 7/8)
  var suppliedParts = null, suppliedLoading = false;
  var _photoUrlCache = {};        // s3_key -> viewable URL (signed or cached data URL)
  var _partPhotoTarget = null;    // { part, status } while snapping a per-part photo
  // Tech vs Ant 🐜 (Stage 1): antGuess undefined=unfetched, null=no confident call, obj=call.
  var antGuess, antGuessBasedOn = 0, antGuessVerdict = null, antGuessOverriding = false, antGuessLoading = false;
  // The 5 inline-editable TDR fields → their real DB column + editor shape.
  // SIMPLE TDR (Teddy 2026-07-07): strip it to the essentials. Customer complaint
  // (auto from intake, shown above), what failed, the part(s) (name + number in ONE
  // box, multiple allowed), whether it's fixed, and labor. No photos/signature on the
  // TDR (those flow into the system on their own).
  var FIELD_META = {
    model_number:     { label: 'Model #',       col: 'model_number',     multiline: false, ph: 'Model # off the sticker (e.g. WED4815EW1)', model: true },
    diagnosis:        { label: 'What failed',   col: 'diagnosis',        multiline: true,  ph: 'What went wrong / what failed?' },
    parts_needed:     { label: 'Part & part #', col: 'parts_needed',     multiline: true,  ph: 'Part name + number', parts: true },
    repair_completed: { label: 'Job status',    col: 'repair_completed', multiline: true,  ph: 'Complete, or second trip needed?', outcome: true },
    labor_hours:      { label: 'Labor hours',   col: 'labor_time_hours', multiline: false, ph: 'e.g. 1.5', numeric: true },
  };
  // The two outcome choices for the Job-status field.
  var OUTCOME_COMPLETE = 'Job complete';
  var OUTCOME_SECOND_TRIP = 'Needs a second trip';
  var OUTCOME_REASSIGN = 'Please reassign';   // tech can't take it — kick back to the office
  // Not fixable / recommend replacement = the SAME outcome (Teddy 7/8): unit shouldn't be
  // repaired, warranty should replace it. John called it "not fixable", Andre "recommend
  // replacement" — one button, both phrasings recorded so either search finds it.
  var OUTCOME_NOT_FIXABLE = 'Not fixable — recommend replacement';

  // 🔩 FIND THE PART (Teddy 2026-07-07: "might be the best tool we've got"). Preload the
  // model # and open a search on each parts site so the tech can quickly confirm the
  // real part number across a few sources. URLs ending in "=" get the query appended.
  var PART_SOURCES = [
    { name: 'Sears PartsDirect', url: 'https://www.searspartsdirect.com/search?q=' },
    { name: 'AppliancePartsPros', url: 'https://www.appliancepartspros.com/search.aspx?model=' },
    { name: 'RepairClinic', url: 'https://www.repairclinic.com/Shop-For-Parts?query=' },
    { name: 'Encompass', url: 'https://www.encompass.com/search?q=' },
    { name: 'PartSelect', url: 'https://www.partselect.com/Search.aspx?SearchTerm=' },
    { name: 'Marcone (sign in)', url: 'https://my.marcone.com' },
  ];

  // ── Boot ───────────────────────────────────────────────────────────
  function init() {
    var p = new URLSearchParams(location.search);
    jobId = p.get('job_id') || p.get('job') || '';
    techId = p.get('tech_id') || '';
    // If the URL dropped tech_id, use the id the tech app stored on this device. The TDR
    // row is keyed by technician_id: a read + write must use the SAME id or they hit
    // different rows (a save with no id lands on a phantom tech-0 row the reader never
    // shows — "it saved but it's gone", 2026-07-21). Invisible when tech_id is already
    // in the URL; only fills the gap when it isn't.
    if (!techId) { try { techId = localStorage.getItem('tn_tech_id') || ''; } catch (_) {} }
    if (!jobId) return; // No job context → no TDR surface
    role = detectRole();
    injectStyles();
    injectButton();
    injectModal();
    refresh();
    pollTimer = setInterval(refresh, POLL_MS);
    window.addEventListener('ant:state-changed', refresh);
    // Make the TDR a first-class nav destination: any surface (the cross-tool
    // strip, a "📝 TDR" button) can open it, and #tdr in the URL auto-opens it
    // so a deep-link lands right on the report. (Teddy 7/4: free flow of nav +
    // add TDR to the tech dashboard ↔ job ↔ Teddy Tool loop.)
    window.antTdrOpen = openModal;
    if ((location.hash || '') === '#tdr') { try { openModal(); } catch (_) {} }
    window.addEventListener('hashchange', function () { if ((location.hash || '') === '#tdr') { try { openModal(); } catch (_) {} } });
  }

  function detectRole() {
    var path = (location.pathname || '').toLowerCase();
    if (path.indexOf('customer-portal') !== -1) return 'customer';
    if (path.indexOf('tech-') !== -1) return 'tech';
    if (path.indexOf('warranty-review') !== -1) return 'office';
    if (path.indexOf('teddy-tdr') !== -1) return 'office';
    if (path.indexOf('job-detail') !== -1) return 'office';
    var p = new URLSearchParams(location.search);
    var qrole = (p.get('role') || '').toLowerCase();
    if (qrole) return qrole;
    return 'office';
  }

  // ── Styles ─────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ant-tdr-card-styles')) return;
    var s = document.createElement('style');
    s.id = 'ant-tdr-card-styles';
    s.textContent = [
      '#ant-tdr-fab { position: fixed; bottom: calc(90px + env(safe-area-inset-bottom, 0px)); left: 50%; transform: translateX(-50%); z-index: 10000; background: linear-gradient(135deg, #10b981, #047857); color: white; border: 0; border-radius: 28px; padding: 14px 22px 14px 18px; font-family: -apple-system, sans-serif; font-size: 15px; font-weight: 800; box-shadow: 0 8px 24px rgba(16,185,129,0.45); cursor: pointer; display: flex; align-items: center; gap: 10px; letter-spacing: 0.02em; transition: transform 0.1s, box-shadow 0.2s; }',
      '#ant-tdr-fab:active { transform: translateX(-50%) scale(0.96); }',
      '#ant-tdr-fab .pct { background: rgba(255,255,255,0.22); border-radius: 18px; padding: 4px 10px; font-size: 13px; font-weight: 900; }',
      '#ant-tdr-fab.ready { background: linear-gradient(135deg, #4ad991, #10b981); box-shadow: 0 8px 28px rgba(74,217,145,0.55); animation: antTdrPulse 1.6s ease-in-out infinite; }',
      '@keyframes antTdrPulse { 0%,100% { box-shadow: 0 8px 24px rgba(74,217,145,0.4); } 50% { box-shadow: 0 8px 36px rgba(74,217,145,0.9); } }',
      '#ant-tdr-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 10001; display: none; align-items: flex-end; justify-content: center; }',
      '#ant-tdr-backdrop.open { display: flex; }',
      '#ant-tdr-sheet { background: #131720; color: #e6e9f0; width: 100%; max-width: 540px; max-height: 88vh; border-radius: 22px 22px 0 0; padding: 22px 18px calc(110px + env(safe-area-inset-bottom, 0px)); overflow-y: auto; font-family: -apple-system, sans-serif; animation: antTdrSlide 0.28s ease-out; }',
      '@keyframes antTdrSlide { from { transform: translateY(40px); opacity: 0.2; } to { transform: translateY(0); opacity: 1; } }',
      '.ant-tdr-grab { width: 44px; height: 5px; background: #4a5060; border-radius: 4px; margin: -10px auto 16px; }',
      '.ant-tdr-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; }',
      '.ant-tdr-title { font-size: 18px; font-weight: 800; color: #e6e9f0; line-height: 1.25; }',
      '.ant-tdr-sub { font-size: 12px; color: #8a92a6; margin-top: 4px; }',
      '.ant-tdr-x { background: rgba(255,255,255,0.06); border: 0; color: #e6e9f0; width: 36px; height: 36px; border-radius: 18px; font-size: 22px; cursor: pointer; flex-shrink: 0; }',
      '.ant-tdr-progress { background: #1c2230; border-radius: 12px; height: 12px; overflow: hidden; margin: 12px 0 6px; }',
      '.ant-tdr-progress-bar { height: 100%; background: linear-gradient(90deg, #10b981, #4ad991); transition: width 0.4s ease; }',
      '.ant-tdr-status { font-size: 13px; color: #b8bfd0; margin-bottom: 18px; font-weight: 600; }',
      '.ant-tdr-status .ready-tag { color: #4ad991; }',
      '.ant-tdr-field { background: #1a1f2c; border: 1px solid #252b3a; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; display: flex; align-items: flex-start; gap: 12px; }',
      '.ant-tdr-field.filled { border-left: 4px solid #10b981; }',
      '.ant-tdr-field.empty { border-left: 4px solid #f5a623; background: rgba(245,166,35,0.06); }',
      '.ant-tdr-field-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }',
      '.ant-tdr-field-body { flex: 1; min-width: 0; }',
      '.ant-tdr-field-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #8a92a6; font-weight: 700; }',
      '.ant-tdr-field-value { font-size: 15px; color: #e6e9f0; margin-top: 3px; word-wrap: break-word; line-height: 1.35; }',
      '.ant-tdr-field-empty-prompt { font-size: 13px; color: #f5a623; margin-top: 3px; font-weight: 600; font-style: italic; }',
      '.ant-tdr-actions { display: flex; gap: 10px; margin-top: 18px; flex-wrap: wrap; }',
      '.ant-tdr-btn { flex: 1; min-width: 140px; padding: 14px 18px; border-radius: 14px; border: 0; font-size: 15px; font-weight: 800; cursor: pointer; font-family: -apple-system, sans-serif; }',
      '.ant-tdr-btn.primary { background: linear-gradient(135deg, #10b981, #047857); color: white; }',
      '.ant-tdr-btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }',
      '.ant-tdr-btn.ghost { background: rgba(255,255,255,0.06); color: #b8bfd0; border: 1px solid #2a3040; }',
      '.ant-tdr-btn.warning { background: linear-gradient(135deg, #f5a623, #c67a0f); color: #0e1118; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── Floating button ────────────────────────────────────────────────
  function injectButton() {
    if (document.getElementById('ant-tdr-fab')) return;
    var btn = document.createElement('button');
    btn.id = 'ant-tdr-fab';
    btn.innerHTML = '<span>📋 TDR</span><span class="pct" id="ant-tdr-fab-pct">--%</span>';
    btn.onclick = openModal;
    document.body.appendChild(btn);
  }

  // ── Modal sheet ────────────────────────────────────────────────────
  function injectModal() {
    if (document.getElementById('ant-tdr-backdrop')) return;
    var back = document.createElement('div');
    back.id = 'ant-tdr-backdrop';
    back.onclick = function (e) { if (e.target === back) closeModal(); };
    var sheet = document.createElement('div');
    sheet.id = 'ant-tdr-sheet';
    sheet.innerHTML = '<div class="ant-tdr-grab"></div><div id="ant-tdr-content">Loading…</div>';
    back.appendChild(sheet);
    document.body.appendChild(back);
  }

  // The global floating buttons (dark-mode toggle bottom-left, Ask-Ant bottom-right)
  // sit at a max z-index and float ON TOP of the TDR sheet — landing right on the
  // lower fields (Teddy 2026-07-07: "a couple of those floating buttons are in the
  // way"). Hide them while the TDR is open; restore on close.
  var STRAY_FABS = ['tn-theme-toggle', 'ant-talk-fab'];
  function toggleStrayFabs(hide) {
    STRAY_FABS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = hide ? 'none' : '';
    });
  }
  function openModal() {
    var back = document.getElementById('ant-tdr-backdrop');
    if (back) back.classList.add('open');
    toggleStrayFabs(true);
    refresh();
    loadSuppliedParts();
  }
  function closeModal() {
    var back = document.getElementById('ant-tdr-backdrop');
    if (back) back.classList.remove('open');
    toggleStrayFabs(false);
  }

  // ── Fetch + render ─────────────────────────────────────────────────
  async function refresh() {
    try {
      var url = XANO + '/get_unified_tdr_status?job_id=' + encodeURIComponent(jobId);
      if (techId) url += '&technician_id=' + encodeURIComponent(techId);
      var r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) return;
      var d = await r.json();
      if (!d || !d.success) return;
      lastData = d;
      renderButton(d);
      renderModal(d);
    } catch (e) {}
  }

  function renderButton(d) {
    var pctEl = document.getElementById('ant-tdr-fab-pct');
    var btn = document.getElementById('ant-tdr-fab');
    if (role === 'customer') {
      // Customer doesn't care about percentages. Show status instead.
      var fields = d.fields || {};
      var repairFilled = !!(fields.repair_completed || {}).filled;
      var diagFilled = !!(fields.diagnosis || {}).filled;
      if (btn) {
        if (repairFilled) {
          btn.innerHTML = '<span>✓ Your Repair</span><span class="pct">Done</span>';
          btn.classList.add('ready');
        } else if (diagFilled) {
          btn.innerHTML = '<span>🔧 Your Repair</span><span class="pct">In Progress</span>';
          btn.classList.remove('ready');
        } else {
          btn.innerHTML = '<span>🐜 Your Repair</span><span class="pct">Live</span>';
          btn.classList.remove('ready');
        }
      }
      return;
    }
    // Progress is over the SIMPLE TDR fields only (Teddy 2026-07-07) — what failed,
    // part(s), job status, labor. Photos/signature aren't on the TDR, and empty extra
    // part boxes never count (only a saved part value marks parts filled), so nothing
    // drags the % down for the tech.
    var pct = simpleTdrPct(d);
    if (pctEl) pctEl.textContent = pct + '%';
    if (btn) {
      if (pct >= 100) btn.classList.add('ready');
      else btn.classList.remove('ready');
    }
  }

  // % complete over the four essentials. Parts counts as done if the tech marked a sent
  // part OR wrote one in (the parts UI is now the 📦 Parts section, not a field tile).
  // The "Part(s) used" list — backed by the warranty-parts event_log (which persists),
  // NOT the parts_needed TDR column (a broken JSON/text-mismatch column whose writes
  // silently no-op and reads come back empty — the reason Jimmy's TDR capped at 75%
  // with "no place to add part numbers", 2026-07-09). A part counts as "used" when the
  // tech marked it Used, or when they wrote it in here (source tdr_used). Falls back to
  // the (usually-empty) server field so nothing regresses if the column is ever fixed.
  function usedPartsList() {
    var out = [];
    (suppliedParts || []).forEach(function (p) {
      var st = String(p.status || '').toLowerCase();
      if ((st === 'used' || p.checked || p.source === 'tdr_used') && p.part && out.indexOf(p.part) === -1) out.push(p.part);
    });
    if (!out.length) {
      // server fallback (parts_needed) in case the column is ever fixed server-side
      splitParts((((lastData && lastData.fields || {}).parts_needed || {}).value || '').toString()).forEach(function (w) { if (w && out.indexOf(w) === -1) out.push(w); });
    }
    if (!out.length) {
      // The part # is often documented inside the "Failed part" text (e.g.
      // "...to be replaced by part #W10613606"). The OFFICE view reads it from there,
      // so recognize it here too — otherwise the tech's card shows the part slot empty
      // (stuck at 80%) while the office shows the number, and the two screens disagree
      // (Danielle's discrepancy, job 20090, 2026-07-21). Pull #-marked part numbers.
      var fc = (((lastData && lastData.fields || {}).failed_component || {}).value || '').toString();
      var m = fc.match(/#\s*([A-Za-z0-9][A-Za-z0-9-]{4,15})/g);
      if (m) m.forEach(function (tok) { var p = tok.replace(/^#\s*/, '').trim(); if (p && out.indexOf(p) === -1) out.push(p); });
    }
    return out;
  }

  function simpleTdrPct(d) {
    var fields = (d && d.fields) || {};
    // ALL 5 must be filled (Teddy 2026-07-09): model #, diagnosis, part & part #, labor, status.
    var model = ((((d || {}).submission_extras || {}).model_number) || (d || {}).model_number || '').toString().trim();
    var modelOk = !!model;
    var diag = !!(fields.diagnosis || {}).filled;
    var partsOk = usedPartsList().length > 0 || !!(fields.parts_needed || {}).filled;
    var status = !!(fields.repair_completed || {}).filled;
    var labor = !!(fields.labor_hours || {}).filled;
    return Math.round([modelOk, diag, partsOk, status, labor].filter(Boolean).length / 5 * 100);
  }
  // The 4 prerequisites that must be filled BEFORE a job status counts (model #, diagnosis,
  // part & part #, labor — the status itself is the 5th, set when the tech picks it). Used
  // to gate completion + the celebration (Teddy 2026-07-09: "must have all 5 filled out").
  function __antTdrRequiredCheck() {
    var d = lastData || {}, f = d.fields || {}, missing = [];
    var model = ((((d.submission_extras || {}).model_number)) || d.model_number || '').toString().trim();
    if (!model) missing.push('Model #');
    if (!(f.diagnosis || {}).filled) missing.push('What failed (diagnosis)');
    if (!(usedPartsList().length > 0)) missing.push('Part & part #');
    if (!(f.labor_hours || {}).filled) missing.push('Labor hours');
    return { ok: missing.length === 0, missing: missing };
  }

  function renderModal(d) {
    var host = document.getElementById('ant-tdr-content');
    if (!host) return;
    // Customer view is fundamentally different - it's a status update,
    // not an internal checklist. Different fields, different language,
    // no editing actions.
    if (role === 'customer') {
      renderCustomerModal(host, d);
      return;
    }
    // Someone is mid-edit — a 6s poll must not wipe their typing.
    if (editKey !== null) return;
    // Don't wipe the tech's one-shot box while they're typing/dictating into it.
    if (recordingNow || antGuessOverriding) return;
    var _os = document.getElementById('ant-tdr-oneshot');
    if (_os && (document.activeElement === _os || String(_os.value || '').trim())) return;
    var fields = d.fields || {};
    // % over the SIMPLE TDR fields only (matches the FAB) — photos/signature aren't on
    // the TDR and empty part boxes never count. (Teddy 2026-07-07.)
    var pct = simpleTdrPct(d);
    var ready = pct >= 100;
    var customerSafe = false;
    var blockingText = buildBlockingText(d);

    // Every warranty claim needs the MODEL # + the PART used and its NUMBER, so both get
    // their own clear, tappable spot on the TDR (Teddy 2026-07-09: "no spot to add the
    // part and part number ... no spot for the model number — both must be added"). Model #
    // saves to the job; Part & part # saves to the warranty-parts log (persists). The
    // "📦 Parts" section below still tracks warranty-sent parts (Used/Return/Not here).
    var fieldOrder = [
      {key: 'model_number',     label: 'Model #',      icon: '🏷️', prompt: 'Model # off the sticker'},
      {key: 'diagnosis',        label: 'What failed',  icon: '🔍', prompt: 'What went wrong / what failed?'},
      {key: 'parts_needed',     label: 'Part & part #',icon: '📦', prompt: 'The part you used + its number'},
      {key: 'repair_completed', label: 'Job status',   icon: '🔧', prompt: 'Complete, or second trip needed?'},
      {key: 'labor_hours',      label: 'Labor hours',  icon: '⏱️', prompt: 'Total time on the job'},
    ];

    var html = '';
    // Header
    html += '<div class="ant-tdr-head">';
    html += '<div><div class="ant-tdr-title">TDR — Job #' + d.job_id + '</div>';
    html += '<div class="ant-tdr-sub">' + escapeHtml(d.customer_first_name || 'Customer') + ' · ' + escapeHtml(d.appliance_summary || '') + '</div></div>';
    html += '<button class="ant-tdr-x" onclick="window.__antTdrClose()">×</button>';
    html += '</div>';
    // Progress
    html += '<div class="ant-tdr-progress"><div class="ant-tdr-progress-bar" style="width:' + pct + '%"></div></div>';
    html += '<div class="ant-tdr-status">';
    if (ready) {
      html += '<span class="ready-tag">✓ Ready for warranty submission</span>';
    } else {
      html += pct + '% complete · ' + blockingText;
    }
    html += '</div>';
    // What the customer already told us — the intake info (complaint, model,
    // serial, claim). This IS the seed for the diagnosis: if the customer
    // described the problem, the TDR is not starting from zero. (Teddy 2026-07-04)
    html += buildCustomerToldUs(d);
    // 📦 PARTS SENT — on a warranty job, the parts the vendor shipped. Tech marks each
    // Used / Return / Not here (drives return-tracking + the claim's returned field).
    if (role === 'tech' || role === 'office') html += buildSuppliedParts();
    // 🔩 FIND THE PART — the main tool for the tech: model # preloaded, one tap opens a
    // search on each parts site to confirm the real part number. Above the TDR fields.
    if (role === 'tech' || role === 'office') html += buildPartFinder(d);
    // ✨ ONE-SHOT fill — the simplest path: say/type (tech) or paste the tech's
    // notes (office) in ONE box, Ant fills all the fields below. Flips the tech
    // from author → editor (confirm a draft, don't type 5 boxes in a hot
    // kitchen); lets the office fill straight from texted-in notes. (Teddy 7/4)
    if (role === 'tech' || role === 'office') html += buildOneShot(d);
    // 🐜 Tech vs Ant — Ant's part guess: confirm it or beat it (fills the part #
    // so the tech never hunts, and trains the moat). Tech only. (Teddy 7/5)
    if (role === 'tech') html += buildAntGuess();
    // Fields — inline-editable for tech + office (tap a field to edit it
    // right here; no jump to another page). Customer never reaches this loop.
    // NOTE: parts_needed is a JSON column that get_unified can't yet read back,
    // so it's shown read-only until the server-side fix lands (no silent-fail
    // editor). The other four save through update_tdr_field_from_voice.
    var canEdit = (role === 'tech' || role === 'office');
    fieldOrder.forEach(function (f) {
      var fState = fields[f.key] || {filled: false, value: ''};
      var isParts = (f.key === 'parts_needed');
      var isModel = (f.key === 'model_number');
      // Parts field is backed by the warranty-parts event_log (persists), not the
      // broken parts_needed column — so it actually shows what the tech entered.
      if (isParts) { var _up = usedPartsList(); fState = { filled: _up.length > 0, value: _up.join('\n') }; }
      // Model # lives on the JOB (submission_extras), not the TDR row — show + edit it here.
      if (isModel) { var _mv = (((d.submission_extras || {}).model_number) || d.model_number || '').toString(); fState = { filled: !!_mv.trim(), value: _mv }; }
      var isOutcome = !!(FIELD_META[f.key] && FIELD_META[f.key].outcome);
      var editable = canEdit && !!FIELD_META[f.key];
      var cls = fState.filled ? 'filled' : 'empty';
      var icon = fState.filled ? '✅' : '⏳';
      var editHandler = isParts ? 'window.__antTdrPartsEdit()'
        : isModel ? 'window.__antTdrModelEdit()'
        : (isOutcome ? 'window.__antTdrOutcomeEdit()' : ('window.__antTdrEdit(\'' + f.key + '\')'));
      var onclick = editable ? ' style="cursor:pointer" onclick="' + editHandler + '"' : '';
      html += '<div class="ant-tdr-field ' + cls + '"' + onclick + '>';
      html += '<div class="ant-tdr-field-icon">' + icon + '</div>';
      html += '<div class="ant-tdr-field-body">';
      var hint = editable ? (fState.filled ? '✏️ edit' : '✏️ add') : '';
      html += '<div class="ant-tdr-field-label">' + escapeHtml(f.label)
        + (hint ? '<span style="float:right;color:#7fa8d8;font-weight:700;letter-spacing:0">' + hint + '</span>' : '') + '</div>';
      if (fState.filled) {
        if (isParts) {
          // Show each part on its own line — name + number together, one per line.
          var pl = splitParts(String(fState.value));
          html += '<div class="ant-tdr-field-value">' + (pl.length ? pl.map(function (p) { return '📦 ' + escapeHtml(p); }).join('<br>') : escapeHtml(String(fState.value))) + '</div>';
        } else {
          html += '<div class="ant-tdr-field-value">' + escapeHtml(String(fState.value)) + '</div>';
        }
      } else {
        html += '<div class="ant-tdr-field-empty-prompt">' + escapeHtml(f.prompt) + '</div>';
      }
      html += '</div></div>';
    });
    // Photos + signature are intentionally NOT on the TDR (Teddy 2026-07-07): they
    // flow into the system on their own (media → database, signature → sign flow),
    // so the TDR stays down to what the tech actually has to tell us.
    // Actions per role
    html += '<div class="ant-tdr-actions">';
    if (role === 'tech') {
      // The one-box (type or 🎤 Speak it) is the primary path. A phone call is a
      // fallback for guys who'd rather talk it out — demoted, not the default.
      html += '<button class="ant-tdr-btn ghost" onclick="window.__antTdrTalk()" style="font-size:13px;flex:1">📞 Rather talk it out? Have Ant call you</button>';
    } else if (role === 'office') {
      var submitDisabled = ready ? '' : 'disabled';
      html += '<button class="ant-tdr-btn primary" ' + submitDisabled + ' onclick="window.__antTdrSubmitWarranty()">📦 Submit Warranty</button>';
      html += '<button class="ant-tdr-btn ghost" onclick="window.__antTdrOpenTeddy()">Open Teddy Tool</button>';
    } else if (role === 'customer') {
      html += '<button class="ant-tdr-btn ghost" onclick="window.__antTdrClose()">Close</button>';
    }
    html += '</div>';
    host.innerHTML = html;
    // Kick off Ant's part prediction once per open (fills the guess card).
    if (role === 'tech' && antGuess === undefined && !antGuessLoading) { antGuessLoading = true; loadAntGuess(); }
    if (role === 'tech' || role === 'office') _hydratePartPhotos();
  }

  // ── Tech vs Ant 🐜 — Ant's part guess: confirm or beat it ─────────
  function buildAntGuess() {
    if (antGuessVerdict) {
      var v = antGuessVerdict;
      var txt = v.beat_ant ? ('🏆 You beat Ant — part ' + escapeHtml(v.part || '')) : ('✓ Confirmed Ant\'s call — part ' + escapeHtml(v.part || '(none)'));
      return '<div style="background:rgba(74,158,255,0.10);border:1px solid rgba(74,158,255,0.4);border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:13.5px;font-weight:800;color:#8fc0ff">🐜 ' + txt + '</div>';
    }
    var open = '<div id="ant-guess-box" style="background:rgba(74,158,255,0.08);border:1px solid rgba(74,158,255,0.35);border-radius:12px;padding:13px 14px;margin-bottom:14px">';
    var head = '<div style="font-size:13px;font-weight:800;color:#8fc0ff;margin-bottom:6px">🐜 Ant vs you — the part</div>';
    var msg = '<div id="ant-guess-msg" style="font-size:12px;color:#8fc0ff;margin-top:6px;min-height:12px"></div>';
    if (antGuess === undefined) return open + head + '<div style="font-size:12.5px;color:#b8bfd0">Checking the part from our repair history…</div></div>';
    if (!antGuess || !antGuess.part_display) {
      return open + head
        + '<div style="font-size:12.5px;color:#b8bfd0;margin-bottom:8px">Ant\'s not sure on this one yet — what part did you use? (You\'re teaching it.)</div>'
        + '<input id="ant-guess-input" type="text" placeholder="OEM part number" style="width:100%;box-sizing:border-box;background:#0f1420;color:#e6e9f0;border:1px solid #3a4256;border-radius:9px;padding:11px 12px;font-size:16px;outline:none">'
        + '<button onclick="window.__antGuessSaveOverride()" style="width:100%;margin-top:8px;background:#1f6fed;color:#fff;border:0;border-radius:9px;padding:11px;font-size:14px;font-weight:800;cursor:pointer">Save the part</button>'
        + msg + '</div>';
    }
    var g = antGuess, conf = Number(g.confidence || 0), seen = Number(g.seen_n || 0), based = Number(antGuessBasedOn || 0);
    var proof = seen ? ('fixed ' + seen + (based ? ' of ' + based : '') + ' similar') : 'best call from our history';
    return open + head
      + '<div style="font-size:12px;color:#b8bfd0;margin-bottom:4px">Ant\'s call — confirm it or beat it:</div>'
      + '<div style="font-size:19px;font-weight:900;color:#e6e9f0;letter-spacing:.02em;font-family:ui-monospace,monospace">' + escapeHtml(g.part_display) + '</div>'
      + '<div style="font-size:12.5px;color:#9fb2cc;margin-top:2px">' + escapeHtml(g.component || '') + ' · <b style="color:#8fc0ff">' + conf + '% sure</b> · ' + proof + '</div>'
      + '<div id="ant-guess-actions" style="display:flex;gap:8px;margin-top:11px">'
      + '<button onclick="window.__antGuessConfirm()" style="flex:1;background:linear-gradient(135deg,#10b981,#047857);color:#fff;border:0;border-radius:10px;padding:12px;font-size:14px;font-weight:800;cursor:pointer">✓ Ant nailed it</button>'
      + '<button onclick="window.__antGuessOverride()" style="flex:1;background:#2a3242;color:#e6e9f0;border:1px solid #3a4256;border-radius:10px;padding:12px;font-size:14px;font-weight:800;cursor:pointer">✗ I\'ve got the real one</button>'
      + '</div>'
      + '<div id="ant-guess-override" style="display:none;margin-top:9px">'
      + '<input id="ant-guess-input" type="text" placeholder="the part # you actually used" style="width:100%;box-sizing:border-box;background:#0f1420;color:#e6e9f0;border:1px solid #3a4256;border-radius:9px;padding:11px 12px;font-size:16px;outline:none">'
      + '<button onclick="window.__antGuessSaveOverride()" style="width:100%;margin-top:8px;background:#1f6fed;color:#fff;border:0;border-radius:9px;padding:11px;font-size:14px;font-weight:800;cursor:pointer">🏆 Save my answer — beat the machine</button>'
      + '</div>' + msg + '</div>';
  }
  async function loadAntGuess() {
    if (!jobId) { antGuess = null; antGuessLoading = false; return; }
    try {
      var r = await fetch('/.netlify/functions/ant-brain-predict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: Number(jobId) }) });
      var d = await r.json();
      antGuessBasedOn = (d && d.based_on_n) || 0;
      var top = (d && d.predictions && d.predictions[0]) || null;
      antGuess = (top && top.part_display) ? top : null;
    } catch (_) { antGuess = null; }
    antGuessLoading = false;
    if (editKey === null && !recordingNow && !antGuessOverriding && lastData) renderModal(lastData);
  }
  // ── Vendor-supplied parts (warranty) — load + render + mark ──────────
  async function loadSuppliedParts() {
    if (!jobId || suppliedLoading) return;
    suppliedLoading = true;
    try {
      var r = await fetch('/.netlify/functions/warranty-parts?job_id=' + encodeURIComponent(jobId), { cache: 'no-store' });
      var d = await r.json();
      suppliedParts = (d && d.ok && Array.isArray(d.parts)) ? d.parts : [];
    } catch (_) { if (suppliedParts === null) suppliedParts = []; }
    suppliedLoading = false;
    // Re-render if the sheet is open and nothing is mid-edit.
    if (editKey === null && !recordingNow && !antGuessOverriding && lastData) {
      var back = document.getElementById('ant-tdr-backdrop');
      if (back && back.classList.contains('open')) renderModal(lastData);
    }
  }

  // The ONE parts area (John 7/8). Lists the parts the warranty SENT — tech taps each
  // Used (installed) / Return (goes back — chargeback risk) / Not here (customer doesn't
  // have it) — and a write-in for any part used that wasn't on the sent list. Always shows
  // for tech/office so the write-in is available even when nothing was sent.
  function buildSuppliedParts() {
    if (role !== 'tech' && role !== 'office') return '';
    var loaded = suppliedParts !== null;
    var parts = suppliedParts || [];
    var writtenIn = splitParts((((lastData && lastData.fields || {}).parts_needed || {}).value || '').toString());
    var toReturn = parts.filter(function (p) { return p.status === 'to_return'; }).length;
    var html = '';
    html += '<div style="background:rgba(245,166,35,0.08);border:1px solid rgba(245,166,35,0.4);border-radius:12px;padding:13px 14px;margin-bottom:14px">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px"><span style="font-size:18px">📦</span><span style="font-size:12px;font-weight:800;color:#f5c266;text-transform:uppercase;letter-spacing:0.05em">Parts</span></div>';
    if (parts.length) {
      html += '<div style="font-size:12px;color:#b8bfd0;margin-bottom:6px;line-height:1.4">Parts the warranty sent — tap each: <b style="color:#4ad991">Used</b> if you installed it, <b style="color:#f5a623">Return</b> if it goes back, <b style="color:#ff8a8a">Not here</b> if the customer doesn\'t have it.'
        + (toReturn ? ' <b style="color:#f5a623">' + toReturn + ' to return</b> — ship them back or we eat a chargeback.' : '') + '</div>';
    } else {
      html += '<div style="font-size:12px;color:#b8bfd0;margin-bottom:6px;line-height:1.4">' + (loaded ? 'No parts came from the warranty for this job. Add any part you used below.' : 'Checking for parts the warranty sent…') + '</div>';
    }
    parts.forEach(function (p) {
      var enc = encodeURIComponent(p.part || '');
      var st = p.status || 'to_return';
      var name = (p.part || '') + (p.description ? ' — ' + p.description : '');
      function btn(label, val, activeColor) {
        var on = st === val;
        return '<button onclick="window.__antTdrPartStatus(decodeURIComponent(\'' + enc + '\'),\'' + val + '\')" style="flex:1;background:' + (on ? activeColor : '#0f1420') + ';color:' + (on ? '#0e1118' : '#b8bfd0') + ';border:1px solid ' + (on ? activeColor : '#3a4256') + ';border-radius:9px;padding:9px 5px;font-size:12.5px;font-weight:800;cursor:pointer">' + label + '</button>';
      }
      html += '<div style="background:#161b26;border:1px solid #252b3a;border-radius:11px;padding:10px 12px;margin-top:8px">';
      html += '<div style="font-size:14px;font-weight:800;color:#e6e9f0;word-wrap:break-word">' + escapeHtml(name) + (p.checked ? ' <span style="color:#4ad991;font-size:12px">✓</span>' : '') + '</div>';
      if (p.tracking) html += '<div style="font-size:11px;color:#8a92a6;margin-top:2px">📮 ' + escapeHtml(p.tracking) + '</div>';
      // 📦 To ORDER (Teddy 2026-07-12): when the tech diagnoses in person and the
      // part ISN'T in hand yet, Used/Return/Not-here don't apply — it needs ordering.
      // Tapping this flags it 'requested' so the office sees it on the to-order list.
      // Used/Return/Not-here stay below for when it arrives + gets installed.
      var _isReq = st === 'to_order';
      html += '<button onclick="window.__antTdrPartStatus(decodeURIComponent(\'' + enc + '\'),\'to_order\')" style="width:100%;margin-top:8px;background:' + (_isReq ? '#f5c266' : '#241d0f') + ';color:' + (_isReq ? '#0e1118' : '#f5c266') + ';border:1px solid #f5c266;border-radius:9px;padding:11px;font-size:13.5px;font-weight:800;cursor:pointer">' + (_isReq ? '📦 On the order list ✓ — office notified' : '📦 Please order this part') + '</button>';
      html += '<div style="font-size:11px;color:#8a92a6;margin:7px 0 4px">Once it arrives + you install it:</div>';
      html += '<div style="display:flex;gap:6px">' + btn('✅ Used', 'used', '#4ad991') + btn('↩️ Return', 'to_return', '#f5a623') + btn('❌ Not here', 'missing', '#ff8a8a') + '</div>';
      if (st === 'to_return') {
        html += '<button onclick="window.__antTdrEmailReturn(decodeURIComponent(\'' + enc + '\'))" style="width:100%;margin-top:8px;background:#132033;color:#8fc0ff;border:1px solid #34507e;border-radius:9px;padding:10px;font-size:13px;font-weight:800;cursor:pointer">📧 Email the return label (me + office)</button>';
      }
      // Photo proof for this part — snap what you used / what's going back. Thumbnails hydrate
      // from S3; a freshly-snapped one shows instantly from the cached data URL.
      html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">';
      (p.photos || []).forEach(function (ph) {
        var src = _photoUrlCache[ph.s3_key] || '';
        var brd = ph.status === 'used' ? '#2e6b4f' : (ph.status === 'missing' ? '#7a2e2e' : '#7a5a1e');
        html += '<img data-s3key="' + escapeHtml(ph.s3_key) + '" src="' + src + '" onclick="window.__antTdrViewPhoto(decodeURIComponent(\'' + encodeURIComponent(ph.s3_key) + '\'))" style="width:50px;height:50px;border-radius:8px;object-fit:cover;border:1px solid ' + brd + ';cursor:pointer;background:#0f1420" alt="part photo">';
      });
      html += '<button onclick="window.__antTdrPartPhoto(decodeURIComponent(\'' + enc + '\'),\'' + st + '\')" style="width:50px;height:50px;border-radius:8px;border:1px dashed #3a4256;background:#0f1420;color:#8fc0ff;font-size:19px;cursor:pointer" title="Take a photo of this part">📷</button>';
      html += '</div>';
      if (!(p.photos || []).length) html += '<div style="font-size:11px;color:#8a92a6;margin-top:4px">📷 Optional: snap this part (proof of what you used / sent back)</div>';
      html += '</div>';
    });
    // Parts the tech wrote in that weren't on the sent list.
    if (writtenIn.length) {
      html += '<div style="font-size:11px;color:#8a92a6;font-weight:700;margin:11px 0 4px">Parts you added (not on the sent list):</div>';
      writtenIn.forEach(function (w) {
        html += '<div style="background:#161b26;border:1px solid #252b3a;border-radius:10px;padding:9px 12px;margin-top:6px;font-size:14px;font-weight:700;color:#e6e9f0;word-wrap:break-word">📦 ' + escapeHtml(w) + '</div>';
      });
    }
    // Add a part that was SENT but not in our list → creates a fully-tracked part
    // (Used / Return / Not here + photo + return label), same as the listed ones.
    // For SquareTrade a sent part may need to go back no matter how it got here.
    // Add a part the tech DIAGNOSED but doesn't have → goes straight on the to-order
    // list (status 'to_order' — office picks the source). Diagnose-in-person → order flow. (Teddy 7/12)
    html += '<button onclick="window.__antTdrAddOrderPart()" style="width:100%;margin-top:10px;background:#241d0f;color:#f5c266;border:1px dashed #f5c266;border-radius:10px;padding:12px;font-size:14px;font-weight:800;cursor:pointer">📦 Add a part to ORDER (diagnosed, not here yet)</button>';
    html += '<button onclick="window.__antTdrAddSentPart()" style="width:100%;margin-top:8px;background:#1a2233;color:#8fc0ff;border:1px dashed #3a4256;border-radius:10px;padding:12px;font-size:14px;font-weight:800;cursor:pointer">➕ Add a part they SENT (in hand, not listed)</button>';
    html += '</div>';
    return html;
  }
  // Add a sent-but-unlisted part → a real tracked supplied part so it gets the same
  // Used / Return / Not here + photo + return-label treatment. Defaults to "Return" so
  // nothing sent gets forgotten (the SquareTrade chargeback risk); the tech taps Used if
  // he installed it.
  window.__antTdrAddSentPart = async function () {
    if (!jobId) { alert('Open this from the job so the part lands on the right one.'); return; }
    var part = window.prompt('Part number (or name) that was sent:');
    if (part === null) return;
    part = String(part).trim(); if (!part) return;
    var desc = window.prompt('Short description (optional — e.g. "control board"):', '');
    if (desc === null) desc = '';
    desc = String(desc).trim();
    var vendor = String((lastData && (lastData.warranty_company || lastData.vendor)) || '');
    // Optimistic: show it right away with the full option set.
    suppliedParts = suppliedParts || [];
    suppliedParts.push({ part: part, description: desc, vendor: vendor, source: 'tech_added', status: 'to_return', checked: false, photos: [] });
    if (lastData && editKey === null) renderModal(lastData);
    try {
      await fetch('/.netlify/functions/warranty-parts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', job_id: Number(jobId), part: part, description: desc, vendor: vendor, source: 'tech_added', status: 'to_return' }),
      });
    } catch (_) {}
    loadSuppliedParts();
  };
  // Add a part the tech DIAGNOSED but doesn't have yet → flagged 'requested' (to
  // order) so the office sees it on the to-order list. Mirrors __antTdrAddSentPart
  // but starts at 'requested' instead of 'to_return'. (Teddy 2026-07-12)
  window.__antTdrAddOrderPart = async function () {
    if (!jobId) { alert('Open this from the job so the part lands on the right one.'); return; }
    var part = window.prompt('Part number (or name) to ORDER:');
    if (part === null) return;
    part = String(part).trim(); if (!part) return;
    var desc = window.prompt('Short description (optional — e.g. "ice maker assembly"):', '');
    if (desc === null) desc = '';
    desc = String(desc).trim();
    var vendor = String((lastData && (lastData.warranty_company || lastData.vendor)) || '');
    suppliedParts = suppliedParts || [];
    suppliedParts.push({ part: part, description: desc, vendor: vendor, source: 'tech_to_order', status: 'to_order', checked: true, photos: [] });
    if (lastData && editKey === null) renderModal(lastData);
    try {
      await fetch('/.netlify/functions/warranty-parts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', job_id: Number(jobId), part: part, description: desc, vendor: vendor, source: 'tech_to_order', status: 'to_order' }),
      });
    } catch (_) {}
    loadSuppliedParts();
  };
  var _returnEmailed = {}; // part -> true, so marking Return only auto-emails once per session
  window.__antTdrPartStatus = async function (part, status) {
    if (!jobId || !part) return;
    // Optimistic: reflect the tap immediately.
    if (suppliedParts) suppliedParts.forEach(function (p) { if (p.part === part) { p.status = status; p.checked = true; } });
    if (lastData && editKey === null) renderModal(lastData);
    try {
      await fetch('/.netlify/functions/warranty-parts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', job_id: Number(jobId), part: part, status: status, by: (role === 'office' ? 'office' : 'tech'), technician_id: Number(techId) || 0 }),
      });
    } catch (_) {}
    // Marking it Return fires the label to the tech + CCs the shop (receipt) automatically —
    // no extra tap. Once per part per session; the button below re-sends. (Teddy 7/8)
    if (status === 'to_return' && !_returnEmailed[part]) _sendReturnEmail(part, true);
    loadSuppliedParts();
  };
  // 📧 Email the prepaid return label to the tech AND cc the shop (a receipt that it was
  // marked for return). Remembers the tech's email (asked once). Server forwards the actual
  // label PDF if the RMA email is on file; else the RMA# / tracking / instructions.
  //   auto=true  → silent if we already know the email; prompt once if we don't.
  //   auto=false → always confirm/edit the email (the manual re-send button).
  async function _sendReturnEmail(part, auto) {
    if (!jobId || !part) return;
    var saved = '';
    try { saved = localStorage.getItem('tn_tech_email') || ''; } catch (_) {}
    var to = saved;
    if (!auto || !saved) {
      to = window.prompt('Email the return label to (we\'ll CC the office):', saved || '');
      if (to === null) return;               // cancelled
      if (!/.+@.+\..+/.test(to)) { alert('Need a valid email.'); return; }
      try { localStorage.setItem('tn_tech_email', to); } catch (_) {}
    }
    _returnEmailed[part] = true;
    var toast = _antTdrToast('📧 Sending the return label…', '#1f6fed');
    try {
      var r = await fetch('/.netlify/functions/email-part-return', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: Number(jobId), part: part, to: to, tech_id: Number(techId) || 0 }),
      });
      var d = await r.json();
      if (d && d.ok) {
        var who = to + (d.cc && d.cc.length ? ' + the office' : '');
        var m = d.mode === 'dry-run' ? ('Email isn\'t switched on yet — logged the return for ' + who)
          : (d.had_label ? ('✅ Return label emailed to ' + who) : ('✅ Return details emailed to ' + who + (d.label_pending ? ' — the prepaid label follows when it lands' : '')));
        toast.set(m, d.mode === 'dry-run' ? '#f5a623' : '#10b981');
      } else { _returnEmailed[part] = false; toast.set('Could not send — ' + ((d && d.error) || 'try again'), '#b91c1c'); }
    } catch (e) { _returnEmailed[part] = false; toast.set('Could not send — try again', '#b91c1c'); }
  }
  window.__antTdrEmailReturn = function (part) { _sendReturnEmail(part, false); };

  // ── Per-part photos — snap proof of what you used / what's going back ──────
  // Reuses /photo-upload (weak-signal-proof) then links the s3_key to the part+status
  // via warranty-parts action:'photo'. The freshly-snapped shot shows instantly from its
  // cached data URL; older ones hydrate to signed thumbnails after render.
  window.__antTdrPartPhoto = function (part, status) {
    if (!jobId) { alert('Open this from the job so the photo lands on the right one.'); return; }
    _partPhotoTarget = { part: part, status: status || '' };
    var inp = document.getElementById('ant-tdr-part-photo-input');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment');
      inp.id = 'ant-tdr-part-photo-input'; inp.style.display = 'none';
      inp.onchange = function () { _partPhotoPicked(this); };
      document.body.appendChild(inp);
    }
    inp.value = ''; inp.click();
  };
  function _partPhotoPicked(input) {
    var file = input && input.files && input.files[0];
    if (!file || !_partPhotoTarget) return;
    var tgt = _partPhotoTarget;
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        try {
          var max = 1600, w = img.width, h = img.height;
          if (w > max || h > max) { var s = Math.min(max / w, max / h); w = Math.round(w * s); h = Math.round(h * s); }
          var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          _uploadPartPhoto(cv.toDataURL('image/jpeg', 0.82), tgt);
        } catch (e) { _uploadPartPhoto(ev.target.result, tgt); }
      };
      img.onerror = function () { _uploadPartPhoto(ev.target.result, tgt); };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }
  async function _uploadPartPhoto(b64, tgt) {
    var toast = _antTdrToast('📤 Uploading photo…', '#1f6fed');
    try {
      var r = await fetch('/.netlify/functions/photo-upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: b64, job_id: Number(jobId), uploaded_by: 'tech' }),
      });
      var d = await r.json();
      if (!d || !d.ok || !d.s3_key) throw new Error((d && d.error) || 'upload failed');
      // Cache the data URL under the real key so the thumbnail is instant (no signing round-trip).
      _photoUrlCache[d.s3_key] = b64;
      // Optimistic: attach to the part in local state.
      if (suppliedParts) suppliedParts.forEach(function (p) { if (p.part === tgt.part) { p.photos = p.photos || []; p.photos.unshift({ s3_key: d.s3_key, status: tgt.status, at: Date.now(), by: 'tech' }); } });
      if (lastData && editKey === null) renderModal(lastData);
      // Link it to the part + status on the server.
      await fetch('/.netlify/functions/warranty-parts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'photo', job_id: Number(jobId), part: tgt.part, status: tgt.status, s3_key: d.s3_key, technician_id: Number(techId) || 0, by: 'tech' }),
      });
      toast.set('✅ Photo added', '#10b981');
      loadSuppliedParts();
    } catch (e) {
      toast.set('❌ Photo didn\'t upload — try again on better signal', '#b91c1c');
    }
  }
  // Open a part photo full-size in a new tab (resolves to a signed URL if not cached).
  window.__antTdrViewPhoto = async function (s3key) {
    var url = _photoUrlCache[s3key];
    if (url) { window.open(url, '_blank'); return; }
    try {
      var r = await fetch('/.netlify/functions/s3-view-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ s3_keys: [s3key] }) });
      var d = await r.json();
      var u = d && d.signed_urls && d.signed_urls[0] && d.signed_urls[0].view_url;
      if (u) { _photoUrlCache[s3key] = u; window.open(u, '_blank'); }
    } catch (_) {}
  };
  // After a render, fill in any part-photo thumbnails whose signed URL we don't have yet.
  async function _hydratePartPhotos() {
    var imgs = document.querySelectorAll('#ant-tdr-content img[data-s3key]');
    if (!imgs || !imgs.length) return;
    var need = [];
    imgs.forEach(function (im) {
      var k = im.getAttribute('data-s3key');
      if (_photoUrlCache[k]) { if (im.src !== _photoUrlCache[k]) im.src = _photoUrlCache[k]; }
      else if (need.indexOf(k) < 0) need.push(k);
    });
    if (!need.length) return;
    try {
      var r = await fetch('/.netlify/functions/s3-view-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ s3_keys: need }) });
      var d = await r.json();
      (d && d.signed_urls || []).forEach(function (s) { if (s && s.s3_key && s.view_url) _photoUrlCache[s.s3_key] = s.view_url; });
      document.querySelectorAll('#ant-tdr-content img[data-s3key]').forEach(function (im) {
        var k = im.getAttribute('data-s3key'); if (_photoUrlCache[k] && !im.src) im.src = _photoUrlCache[k];
      });
    } catch (_) {}
  }
  // Tiny sticky toast inside the sheet.
  function _antTdrToast(text, bg) {
    var host = document.getElementById('ant-tdr-content');
    var el = document.createElement('div');
    el.style.cssText = 'position:sticky;top:0;z-index:30;background:' + (bg || '#1f6fed') + ';color:#fff;padding:11px 14px;border-radius:10px;margin-bottom:12px;font-weight:800;font-size:13px';
    el.textContent = text;
    if (host) host.insertBefore(el, host.firstChild);
    return { set: function (t, c) { el.textContent = t; if (c) el.style.background = c; setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 5000); } };
  }

  function _guessMsg(t, color) { var m = document.getElementById('ant-guess-msg'); if (m) { m.style.color = color || '#8fc0ff'; m.textContent = t; } }
  async function _postVerdict(verdict, techPart) {
    var g = antGuess || {};
    try {
      var r = await fetch('/.netlify/functions/ant-brain-verdict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        job_id: Number(jobId), tech_id: Number(techId) || 0, tdr_id: Number((lastData && lastData.tdr_id) || 0), verdict: verdict,
        ant_part: (g.part_display || ''), ant_component: (g.component || ''), ant_confidence: Number(g.confidence || 0), tech_part: techPart || '',
      }) });
      return await r.json();
    } catch (_) { return { ok: false }; }
  }
  window.__antGuessConfirm = async function () {
    _guessMsg('Saving…');
    var d = await _postVerdict('confirmed', '');
    if (d && d.ok) { antGuessVerdict = { verdict: 'confirmed', part: d.part, beat_ant: false }; if (lastData) renderModal(lastData); refresh(); }
    else _guessMsg('Could not save — try again', '#ff9d4a');
  };
  window.__antGuessOverride = function () {
    antGuessOverriding = true;
    var box = document.getElementById('ant-guess-override'); if (box) box.style.display = 'block';
    var acts = document.getElementById('ant-guess-actions'); if (acts) acts.style.display = 'none';
    var inp = document.getElementById('ant-guess-input'); if (inp) inp.focus();
  };
  window.__antGuessSaveOverride = async function () {
    var inp = document.getElementById('ant-guess-input');
    var part = inp ? String(inp.value || '').trim() : '';
    if (!part) { _guessMsg('Type the part # you used', '#ff9d4a'); return; }
    _guessMsg('Saving…');
    var d = await _postVerdict('overridden', part);
    antGuessOverriding = false;
    if (d && d.ok) { antGuessVerdict = { verdict: 'overridden', part: d.part || part, beat_ant: true }; if (lastData) renderModal(lastData); refresh(); }
    else { _guessMsg('Could not save — try again', '#ff9d4a'); }
  };

  // ── Customer-friendly view — sanitized, no tech jargon ───────────
  function renderCustomerModal(host, d) {
    var fields = d.fields || {};
    var diag = (fields.diagnosis || {}).value || '';
    var repair = (fields.repair_completed || {}).value || '';
    var parts = (fields.parts_needed || {}).value || '';
    var diagFilled = !!(fields.diagnosis || {}).filled;
    var repairFilled = !!(fields.repair_completed || {}).filled;
    var partsFilled = !!(fields.parts_needed || {}).filled;
    var photoCount = d.attachments_count || 0;
    // Customer status banner — derived from filled state
    var status, statusColor, statusIcon;
    if (repairFilled) {
      status = 'Repair Complete';
      statusColor = '#10b981';
      statusIcon = '✓';
    } else if (diagFilled) {
      status = 'Repair In Progress';
      statusColor = '#4ca7ff';
      statusIcon = '🔧';
    } else {
      status = 'Tech En Route';
      statusColor = '#f5a623';
      statusIcon = '🚗';
    }

    var html = '';
    // Header — no Job # for customer
    html += '<div class="ant-tdr-head">';
    html += '<div><div class="ant-tdr-title">Your Repair</div>';
    html += '<div class="ant-tdr-sub">' + escapeHtml(d.appliance_summary || 'Appliance') + '</div></div>';
    html += '<button class="ant-tdr-x" onclick="window.__antTdrClose()">×</button>';
    html += '</div>';
    // Status banner
    html += '<div style="background:' + statusColor + '22;border:1px solid ' + statusColor + ';border-radius:14px;padding:14px 16px;margin:14px 0 16px;display:flex;align-items:center;gap:14px">';
    html += '<div style="font-size:28px">' + statusIcon + '</div>';
    html += '<div><div style="font-size:17px;font-weight:800;color:' + statusColor + '">' + status + '</div>';
    html += '<div style="font-size:12px;color:#b8bfd0;margin-top:2px">Your tech is documenting everything for you.</div></div>';
    html += '</div>';
    // What we found
    if (diagFilled) {
      html += customerCard('🔍', 'What we found', diag);
    }
    // What we fixed
    if (repairFilled) {
      html += customerCard('🔧', 'What we did', repair);
    }
    // Parts replaced (only if non-trivial)
    if (partsFilled && parts.toLowerCase() !== 'none') {
      html += customerCard('📦', 'Parts replaced', parts);
    }
    // Photos
    if (photoCount > 0) {
      html += customerCard('📷', 'Photos on file', photoCount + ' photo' + (photoCount === 1 ? '' : 's') + ' from your appointment');
    }
    // If nothing captured yet, friendly placeholder
    if (!diagFilled && !repairFilled && !partsFilled) {
      html += '<div style="background:#1a1f2c;border:1px solid #252b3a;border-radius:12px;padding:18px 16px;text-align:center;color:#b8bfd0;font-size:13px;line-height:1.5">Your tech hasn\'t added details yet. Once they start the diagnosis, you\'ll see what they found here in real time.</div>';
    }
    // Close button
    html += '<div class="ant-tdr-actions" style="margin-top:18px"><button class="ant-tdr-btn ghost" onclick="window.__antTdrClose()" style="flex:1">Close</button></div>';
    host.innerHTML = html;
  }

  function customerCard(icon, label, value) {
    return '<div style="background:#1a1f2c;border:1px solid #252b3a;border-left:4px solid #10b981;border-radius:12px;padding:14px 16px;margin-bottom:10px">'
      + '<div style="display:flex;align-items:flex-start;gap:12px">'
      + '<div style="font-size:18px;flex-shrink:0;margin-top:1px">' + icon + '</div>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#8a92a6;font-weight:700">' + escapeHtml(label) + '</div>'
      + '<div style="font-size:15px;color:#e6e9f0;margin-top:4px;line-height:1.45;word-wrap:break-word">' + escapeHtml(String(value)) + '</div>'
      + '</div></div></div>';
  }

  // The intake info the customer already gave us — shown at the top of the
  // internal (office/tech) TDR so nobody re-asks what's already on file, and
  // so the diagnosis has a starting point. Copy buttons on each field.
  // 🔩 Find-the-part widget: model # preloaded, one tap per parts site.
  function buildPartFinder(d) {
    var x = d.submission_extras || {};
    var model = (x.model_number || '').toString().trim();
    var html = '';
    html += '<div class="ant-tdr-field" style="flex-direction:column;align-items:stretch;gap:0;border-left:4px solid #6aa3ff;background:rgba(106,163,255,0.08)">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:18px">🔩</span><span style="font-size:12px;font-weight:800;color:#8fc0ff;text-transform:uppercase;letter-spacing:0.05em">Find the part</span></div>';
    html += '<div style="font-size:12px;color:#9aa3b7;margin-bottom:9px">' + (model ? 'Model # is loaded' : 'Type a model # or part #') + ' — tap a site to look it up.</div>';
    html += '<input id="ant-tdr-partfind" type="text" value="' + escapeHtml(model) + '" placeholder="Model # or part #" style="' + PART_EDITOR_STYLE + ';margin-bottom:10px">';
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
    PART_SOURCES.forEach(function (s, i) {
      html += '<button onclick="window.__antTdrFindPart(' + i + ')" style="flex:1 1 44%;min-width:44%;background:#16203a;color:#cfe0ff;border:1px solid #34507e;border-radius:10px;padding:12px 10px;font-size:13px;font-weight:800;cursor:pointer">🔍 ' + escapeHtml(s.name) + '</button>';
    });
    html += '</div></div>';
    return html;
  }

  function buildCustomerToldUs(d) {
    var x = d.submission_extras || {};
    var complaint = (x.problem_summary || '').toString().trim();
    var model = (x.model_number || '').toString().trim();
    var serial = (x.serial_number || '').toString().trim();
    var claim = (x.claim_number || '').toString().trim();
    if (!complaint && !model && !serial && !claim) return '';
    var rows = '';
    function row(label, val, big) {
      if (!val) return '';
      var esc = escapeHtml(val);
      var enc = encodeURIComponent(val);
      return '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-top:1px solid rgba(255,255,255,0.06)">'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#7fa8d8;font-weight:700">' + escapeHtml(label) + '</div>'
        + '<div style="font-size:' + (big ? '15px' : '14px') + ';color:#e6e9f0;margin-top:3px;line-height:1.4;word-wrap:break-word">' + esc + '</div>'
        + '</div>'
        + '<button onclick="window.__antTdrCopy(decodeURIComponent(\'' + enc + '\'),this)" style="flex-shrink:0;background:rgba(255,255,255,0.08);border:0;color:#cfe0f5;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer">📋</button>'
        + '</div>';
    }
    rows += row('Customer\'s complaint', complaint, true);
    rows += row('Model #', model, false);
    rows += row('Serial #', serial, false);
    rows += row('Claim #', claim, false);
    var seedBtn = '';
    if (complaint && (role === 'office' || role === 'tech')) {
      seedBtn = '<button onclick="window.__antTdrSeedDiagnosis()" style="margin-top:10px;width:100%;background:rgba(74,158,255,0.16);border:1px solid rgba(74,158,255,0.5);color:#8fc0ff;border-radius:10px;padding:10px;font-size:13px;font-weight:800;cursor:pointer">✏️ Start the diagnosis from this →</button>';
    }
    return '<div style="background:rgba(74,158,255,0.07);border:1px solid rgba(74,158,255,0.28);border-radius:12px;padding:12px 14px;margin-bottom:14px">'
      + '<div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800;color:#8fc0ff;letter-spacing:0.02em">📩 What the customer told us</div>'
      + rows
      + seedBtn
      + '</div>';
  }

  // The one-box: dump everything you found (talk via the keyboard 🎤 or type),
  // Ant fills diagnosis / failed part / repair / labor below. One save, not five.
  function buildOneShot(d) {
    var isOffice = (role === 'office');
    var head = isOffice ? '✨ Fill the report from the tech\'s notes' : '✨ Fill the whole report at once';
    var sub = isOffice
      ? 'Paste what the tech texted or told you — what was wrong, the part, what they did, how long. Ant fills the fields below; you review and save.'
      : 'Say or type everything you found — what was wrong, the part, what you did, how long. Ant fills the fields below. Tap the 🎤 on your keyboard to talk instead of type.';
    var ph = isOffice
      ? 'Paste the tech\'s notes here…'
      : 'e.g. Ice maker wasn\'t making ice, replaced the icemaker assembly, about an hour, tested and it\'s working now';
    // Tech gets a 🎤 that records in-app (Whisper) + fills — reliable, unlike a
    // phone call. Office just pastes + fills.
    var actions = isOffice
      ? '<button id="ant-tdr-oneshot-btn" onclick="window.__antTdrFillFromNotes()" style="width:100%;margin-top:9px;background:linear-gradient(135deg,#10b981,#047857);color:#fff;border:0;border-radius:10px;padding:13px;font-size:15px;font-weight:800;cursor:pointer">✨ Fill the report</button>'
      : '<div style="display:flex;gap:8px;margin-top:9px">'
        + '<button id="ant-tdr-mic" onclick="window.__antTdrMic()" style="flex:1;background:#0f1420;color:#4ad991;border:1px solid #2f7a5c;border-radius:10px;padding:13px;font-size:15px;font-weight:800;cursor:pointer">🎤 Speak it</button>'
        + '<button id="ant-tdr-oneshot-btn" onclick="window.__antTdrFillFromNotes()" style="flex:1;background:linear-gradient(135deg,#10b981,#047857);color:#fff;border:0;border-radius:10px;padding:13px;font-size:15px;font-weight:800;cursor:pointer">✨ Fill it in</button>'
        + '</div>';
    return '<div style="background:rgba(16,185,129,0.09);border:1px solid rgba(16,185,129,0.45);border-radius:12px;padding:13px 14px;margin-bottom:14px">'
      + '<div style="font-size:13.5px;font-weight:800;color:#4ad991;margin-bottom:3px">' + head + '</div>'
      + '<div style="font-size:12px;color:#b8bfd0;margin-bottom:9px;line-height:1.4">' + sub + '</div>'
      + '<textarea id="ant-tdr-oneshot" rows="3" placeholder="' + escapeHtml(ph) + '" style="width:100%;box-sizing:border-box;background:#0f1420;color:#e6e9f0;border:1px solid #3a4256;border-radius:10px;padding:11px 12px;font-size:16px;line-height:1.4;outline:none;resize:vertical"></textarea>'
      + actions
      + '<div id="ant-tdr-oneshot-msg" style="font-size:12px;color:#8fc0ff;margin-top:7px;min-height:14px"></div>'
      + '</div>';
  }
  // 🎤 In-app voice for the one-box: record → Whisper → drop the words in the box
  // → fill. Reliable dictation (iOS records mp4/AAC, not webm — tag the real type),
  // replacing the flaky "Ant calls you" scribe as the primary talk path. (Teddy 7/4)
  window.__antTdrMic = async function () {
    var btn = document.getElementById('ant-tdr-mic');
    var msg = document.getElementById('ant-tdr-oneshot-msg');
    if (_rec && _rec.state === 'recording') { _rec.stop(); return; }
    var stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (_) { if (msg) { msg.style.color = '#ff9d4a'; msg.textContent = 'Mic blocked — allow the microphone, or just type.'; } return; }
    var recMime = '';
    try { var cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/aac', 'audio/mpeg']; for (var i = 0; i < cands.length; i++) { if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(cands[i])) { recMime = cands[i]; break; } } } catch (_) {}
    _chunks = [];
    try { _rec = recMime ? new MediaRecorder(stream, { mimeType: recMime }) : new MediaRecorder(stream); }
    catch (_) { try { _rec = new MediaRecorder(stream); } catch (__) { if (msg) msg.textContent = 'Recording not supported — type it.'; stream.getTracks().forEach(function (t) { t.stop(); }); return; } }
    _rec.ondataavailable = function (e) { if (e.data && e.data.size) _chunks.push(e.data); };
    _rec.onstop = async function () {
      recordingNow = false;
      stream.getTracks().forEach(function (t) { t.stop(); });
      if (btn) { btn.textContent = '🎤 Speak it'; btn.style.background = '#0f1420'; btn.style.color = '#4ad991'; }
      var realType = ((_rec && _rec.mimeType) || recMime || 'audio/webm').split(';')[0];
      var ext = /mp4|aac|m4a|mpeg|mp3/i.test(realType) ? 'm4a' : 'webm';
      var blob = new Blob(_chunks, { type: realType });
      if (blob.size < 800) { if (msg) { msg.style.color = '#ff9d4a'; msg.textContent = "Didn't catch that — try again."; } return; }
      if (msg) { msg.style.color = '#8fc0ff'; msg.textContent = 'Transcribing…'; }
      var text = '';
      try { var fd = new FormData(); fd.append('audio', blob, 'report.' + ext); var r = await fetch('/.netlify/functions/whisper-transcribe', { method: 'POST', body: fd }); var jd = await r.json(); text = ((jd && jd.text) || '').trim(); } catch (_) {}
      if (!text) { if (msg) { msg.style.color = '#ff9d4a'; msg.textContent = 'Could not hear it — type it instead.'; } return; }
      var ta = document.getElementById('ant-tdr-oneshot'); if (ta) ta.value = (ta.value ? ta.value.trim() + ' ' : '') + text;
      window.__antTdrFillFromNotes();
    };
    recordingNow = true;
    _rec.start();
    if (btn) { btn.textContent = '⏹ Stop'; btn.style.background = '#d94545'; btn.style.color = '#fff'; }
    if (msg) { msg.style.color = '#8fc0ff'; msg.textContent = 'Recording — say what you found, the part, what you did, how long. Tap Stop when done.'; }
  };
  window.__antTdrFillFromNotes = async function () {
    var ta = document.getElementById('ant-tdr-oneshot');
    var msg = document.getElementById('ant-tdr-oneshot-msg');
    var btn = document.getElementById('ant-tdr-oneshot-btn');
    var text = ta ? String(ta.value || '').trim() : '';
    var complaint = ((lastData && lastData.submission_extras || {}).problem_summary || '').toString().trim();
    var src = [text, complaint ? ('Customer complaint: ' + complaint) : ''].filter(Boolean).join('\n');
    if (src.replace(/\s/g, '').length < 4) { if (msg) { msg.style.color = '#ff9d4a'; msg.textContent = 'Type or say what you found first.'; } return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Reading…'; }
    if (msg) { msg.style.color = '#8fc0ff'; msg.textContent = 'Ant is reading your notes…'; }
    var ex = null;
    try {
      var r = await fetch('/.netlify/functions/extract-tdr-from-transcript', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: src }) });
      var jd = await r.json();
      if (jd && jd.ok && jd.extracted) ex = jd.extracted;
    } catch (e) {}
    if (!ex) { if (btn) { btn.disabled = false; btn.textContent = '✨ Fill the report'; } if (msg) { msg.style.color = '#ff9d4a'; msg.textContent = 'Could not read it — try again, or fill the fields below.'; } return; }
    var fields = (lastData && lastData.fields) || {};
    var toWrite = [];
    function add(key, val) { if (val != null && String(val).trim() && !((fields[key] || {}).filled)) toWrite.push({ key: key, value: String(val).trim() }); }
    add('diagnosis', ex.diagnosis);
    // Keep the part number WITH the failed part (Jimmy 7/6: it kept landing in the
    // Repair narrative instead of Failed Part). Append the extracted part # to the
    // failed component if Ant split them out.
    var _fc = String(ex.failed_component || '').trim();
    var _pn = String(ex.part_number || '').trim();
    if (_pn) { if (!_fc) _fc = _pn; else if (_fc.toUpperCase().indexOf(_pn.toUpperCase()) === -1) _fc = _fc + ' (' + _pn + ')'; }
    add('failed_component', _fc);
    add('repair_completed', ex.repair_completed);
    if (ex.labor_time_hours && Number(ex.labor_time_hours) > 0) add('labor_hours', String(ex.labor_time_hours));
    if (!toWrite.length) { if (btn) { btn.disabled = false; btn.textContent = '✨ Fill the report'; } if (msg) { msg.style.color = '#8fc0ff'; msg.textContent = 'Those are already filled — check them below.'; } return; }
    // Resolve the tech whose TDR this is: URL tech_id, else the loaded status,
    // else the job's assigned tech (get_job) — so an office paste lands on the
    // right report instead of creating a tech_id=0 phantom.
    var writeTech = Number(techId) || Number((lastData && lastData.technician_id) || 0) || 0;
    if (!writeTech) {
      try { var gj = await fetch(XANO + '/get_job?job_id=' + Number(jobId)).then(function (x) { return x.json(); }); writeTech = Number(gj && gj.technician_id) || 0; } catch (e) {}
    }
    var ok = 0;
    for (var i = 0; i < toWrite.length; i++) {
      try {
        var body = { job_id: Number(jobId), field: toWrite[i].key, value: toWrite[i].value };
        if (writeTech) body.technician_id = writeTech;
        var wr = await fetch(XANO + '/update_tdr_field_from_voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        var wd = await wr.json();
        if (wd && wd.success) ok++;
      } catch (e) {}
    }
    if (msg) { msg.style.color = '#4ad991'; msg.textContent = '✓ Filled ' + ok + ' field' + (ok === 1 ? '' : 's') + ' — check them below, tap any to fix.'; }
    if (ta) ta.value = '';
    editKey = null;
    setTimeout(function () { refresh(); try { window.dispatchEvent(new Event('ant:state-changed')); } catch (_) {} }, 950);
  };

  function buildBlockingText(d) {
    var b = d.blocking || {};
    // SIMPLE TDR (Teddy 2026-07-07): only these four can "block". Photos, signature and
    // the old failed_component are no longer on the TDR, so even if the server still
    // flags them we never surface them as missing.
    var labels = {
      diagnosis: 'what failed',
      parts_needed: 'part(s)',
      repair_completed: 'job status',
      labor_hours: 'labor hours',
    };
    // Parts is satisfied by a marked sent-part OR a written-in part (the 📦 Parts section),
    // not just the parts_needed field — so don't nag for parts once either is done.
    var partsOk = !!((d.fields || {}).parts_needed || {}).filled || !!(suppliedParts && suppliedParts.some(function (p) { return p.checked; }));
    var missing = [];
    for (var k in b) {
      if (k === 'parts_needed' && partsOk) continue;
      if (b[k] && labels[k]) missing.push(labels[k]);
    }
    if (missing.length === 0) return 'ready to submit';
    if (missing.length === 1) return 'needs ' + missing[0];
    if (missing.length === 2) return 'needs ' + missing[0] + ' + ' + missing[1];
    return 'needs ' + missing.slice(0, 2).join(', ') + ' (+' + (missing.length - 2) + ' more)';
  }

  // ── Submission package builder (office click on Submit Warranty) ──
  function buildSubmissionPackage(d) {
    var fields = d.fields || {};
    var extras = d.submission_extras || {};
    function val(f) { return ((fields[f] || {}).value || '').toString().trim(); }
    var ts = new Date().toISOString().replace('T', ' ').replace('Z', ' UTC');
    var lines = [];
    lines.push('TN APPLIANCE EXCHANGE — WARRANTY SUBMISSION');
    lines.push('========================================');
    lines.push('Job: #' + d.job_id);
    lines.push('Customer: ' + (d.customer_first_name || '') + ' ' + (extras.customer_last_name || ''));
    lines.push('Phone: ' + (extras.customer_phone || ''));
    var addr = (extras.service_address || '');
    var locline = [extras.customer_city, extras.customer_state].filter(Boolean).join(', ');
    if (addr) lines.push('Address: ' + addr + (locline ? ' (' + locline + ')' : ''));
    lines.push('Vendor: ' + (d.warranty_company || 'unknown'));
    if (extras.claim_number) lines.push('Claim #: ' + extras.claim_number);
    lines.push('');
    lines.push('APPLIANCE');
    lines.push('  Type: ' + (d.appliance_summary || ''));
    if (extras.model_number) lines.push('  Model: ' + extras.model_number);
    if (extras.serial_number) lines.push('  Serial: ' + extras.serial_number);
    lines.push('');
    lines.push('DIAGNOSIS');
    lines.push('  ' + (val('diagnosis') || '(not captured)'));
    lines.push('');
    lines.push('FAILED COMPONENT');
    lines.push('  ' + (val('failed_component') || '(not captured)'));
    lines.push('');
    lines.push('REPAIR PERFORMED');
    lines.push('  ' + (val('repair_completed') || '(not captured)'));
    lines.push('');
    lines.push('PARTS USED');
    lines.push('  ' + (val('parts_needed') || '(none)'));
    lines.push('');
    lines.push('LABOR');
    lines.push('  ' + (val('labor_hours') || '?') + ' hours');
    if (val('customer_notes')) {
      lines.push('');
      lines.push('CUSTOMER NOTES');
      lines.push('  ' + val('customer_notes'));
    }
    if (extras.problem_summary) {
      lines.push('');
      lines.push('ORIGINAL COMPLAINT');
      lines.push('  ' + extras.problem_summary);
    }
    lines.push('');
    lines.push('DOCUMENTATION');
    lines.push('  Photos on file: ' + (d.attachments_count || 0));
    lines.push('  Customer signature: ' + (d.has_signature ? 'Yes' : 'No'));
    lines.push('');
    lines.push('PARTS POLICY');
    lines.push('  TN Appliance Exchange installs only parts supplied by our');
    lines.push('  company. Customer-purchased parts are not installed. This');
    lines.push('  ensures the correct part is used and allows us to stand');
    lines.push('  behind the repair.');
    lines.push('');
    lines.push('Submitted via Ant · ' + ts);
    return lines.join('\n');
  }

  function tdrCopyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(function () { tdrFallbackCopy(text); });
    } else {
      tdrFallbackCopy(text);
    }
  }
  function tdrFallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
  }
  function tdrPortalUrlForVendor(v) {
    var n = (v || '').toLowerCase().replace(/\s+/g, '');
    if (n.indexOf('square') !== -1) return 'https://provider.squaretrade.com/';
    if (n === 'ahs' || n.indexOf('americanhome') !== -1) return 'https://contractor.ahs.com/';
    if (n.indexOf('frontdoor') !== -1) return 'https://www.frontdoor.com/pro/';
    if (n.indexOf('allstate') !== -1) return 'https://allstateprotectionplans.com/';
    if (n.indexOf('nsa') !== -1) return 'https://contractors.nsai.com/';
    return '';
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  // Split a saved parts value into individual parts (one per line, comma also ok).
  function splitParts(s) {
    return String(s == null ? '' : s).split(/[\n,]+/).map(function (x) { return x.trim(); }).filter(function (x) { return x.length; });
  }

  // ── Action handlers ────────────────────────────────────────────────
  window.__antTdrClose = closeModal;
  window.__antTdrTalk = async function () {
    if (!jobId || !techId) { alert('Open this from your job so Ant knows who to call. Or just type/🎤 Speak it above.'); return; }
    if (!confirm('Ant will call your phone now. Just talk through the job — what was wrong, the part, what you did, how long — and it writes your report. Ready?')) return;
    try {
      var r = await fetch(XANO + '/dispatch_ant_field_assist', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({job_id: Number(jobId), tech_id: Number(techId), mode: 'wrap_up'}),
      });
      var d = await r.json();
      if (d && d.success) alert('📞 Calling you now — answer and talk it through. Your report fills in as you go.');
      else alert("Couldn't place the call — just type or 🎤 Speak it above instead. (" + (d && d.error || 'try again') + ')');
    } catch (e) { alert("Couldn't place the call — type or 🎤 Speak it above instead."); }
  };
  window.__antTdrOpenTech = function () {
    location.href = '/tech-simple.html?job_id=' + jobId + (techId ? '&tech_id=' + techId : '');
  };
  window.__antTdrCopy = function (text, btn) {
    tdrCopyToClipboard(String(text || ''));
    if (btn) { var o = btn.textContent; btn.textContent = '✓'; setTimeout(function () { btn.textContent = o; }, 1200); }
  };
  window.__antTdrSeedDiagnosis = function () { window.__antTdrEdit('diagnosis'); };

  // ── Photos — tap the Photos row, snap/pick, upload right here ──────────
  window.__antTdrAddPhoto = function () {
    var inp = document.getElementById('ant-tdr-photo-input');
    if (inp) { inp.value = ''; inp.click(); }
  };
  window.__antTdrPhotoPicked = function (input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    if (!jobId) { alert('Open this from the job so the photo lands on the right one.'); return; }
    // Downscale client-side (weak-signal proof) then send to /photo-upload.
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        try {
          var max = 1600, w = img.width, h = img.height;
          if (w > max || h > max) { var s = Math.min(max / w, max / h); w = Math.round(w * s); h = Math.round(h * s); }
          var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          var b64 = cv.toDataURL('image/jpeg', 0.82);
          uploadTdrPhoto(b64);
        } catch (e) { uploadTdrPhoto(ev.target.result); } // fallback: send as-is
      };
      img.onerror = function () { uploadTdrPhoto(ev.target.result); };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  async function uploadTdrPhoto(b64) {
    var host = document.getElementById('ant-tdr-content');
    var note = document.createElement('div');
    note.style.cssText = 'position:sticky;top:0;z-index:20;background:#1f6fed;color:#fff;padding:11px 14px;border-radius:10px;margin-bottom:12px;font-weight:800;font-size:13px';
    note.textContent = '📤 Uploading photo…';
    if (host) host.insertBefore(note, host.firstChild);
    try {
      var r = await fetch('/.netlify/functions/photo-upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: b64, job_id: Number(jobId), uploaded_by: 'tech' }),
      });
      var d = await r.json();
      if (!d || !d.ok) throw new Error((d && d.error) || 'upload failed');
      note.style.background = '#10b981'; note.textContent = '✅ Photo added';
      await refresh();
      try { window.dispatchEvent(new Event('ant:state-changed')); } catch (_) {}
      setTimeout(function () { if (note.parentNode) note.parentNode.removeChild(note); }, 1800);
    } catch (e) {
      note.style.background = '#b91c1c';
      note.textContent = '❌ Photo didn\'t upload — try again on better signal (' + (e && e.message ? e.message : e) + ')';
      setTimeout(function () { if (note.parentNode) note.parentNode.removeChild(note); }, 5000);
    }
  }

  // ── Signature — tap the row → open the sign page to hand the customer ──
  window.__antTdrGetSignature = function () {
    if (!jobId) { alert('Open this from the job first.'); return; }
    location.href = '/sign.html?job_id=' + jobId + (techId ? '&tech_id=' + techId : '');
  };

  var PART_EDITOR_STYLE = 'width:100%;box-sizing:border-box;background:#0f1420;color:#e6e9f0;border:1px solid #3a4256;border-radius:12px;padding:13px 14px;font-size:16px;font-family:-apple-system,sans-serif;line-height:1.4;outline:none';

  // 🔩 Find the part — open the chosen source's search with the entered model/part #.
  window.__antTdrFindPart = function (i) {
    var s = PART_SOURCES[i]; if (!s) return;
    var el = document.getElementById('ant-tdr-partfind');
    var q = el ? String(el.value || '').trim() : '';
    var url = (s.url.slice(-1) === '=') ? (s.url + encodeURIComponent(q)) : s.url;
    try { window.open(url, '_blank', 'noopener'); } catch (_) { location.href = url; }
  };

  // ── Part(s) used — MULTI-PART editor (Teddy 2026-07-07). One box per part, name +
  // number together (e.g. "Ice maker assembly W10250000"). Add as many as the job
  // needs; blank boxes are ignored, so they never count against completion. Saves the
  // non-empty parts newline-joined into parts_needed.
  window.__antTdrPartsEdit = function () {
    if (!lastData) return;
    if (role !== 'tech' && role !== 'office') return;
    editKey = 'parts_needed';
    var host = document.getElementById('ant-tdr-content'); if (!host) return;
    var parts = usedPartsList().slice();   // from the warranty-parts log (persists)
    if (!parts.length) parts = [''];
    parts.push('');   // one spare empty box ready to fill
    var html = '';
    html += '<div class="ant-tdr-head"><div><div class="ant-tdr-title">Part(s) used</div>';
    html += '<div class="ant-tdr-sub">Job #' + lastData.job_id + ' · ' + escapeHtml(lastData.appliance_summary || '') + '</div></div>';
    html += '<div style="display:flex;gap:8px;align-items:center;flex:0 0 auto">';
    html += '<button class="ant-tdr-save-btn" onclick="window.__antTdrSaveParts()" style="background:linear-gradient(135deg,#10b981,#047857);color:#fff;border:0;border-radius:10px;padding:11px 18px;font-size:15px;font-weight:800;cursor:pointer;white-space:nowrap">✓ Save</button>';
    html += '<button class="ant-tdr-x" onclick="window.__antTdrCancelEdit()" title="cancel — do not save">×</button>';
    html += '</div></div>';
    html += '<div style="background:rgba(74,158,255,0.12);border:1px solid rgba(74,158,255,0.4);color:#8fc0ff;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:700;margin-bottom:12px">📦 One box per part — name + number together. Add as many as you used; leave extras blank (blanks never count against you).</div>';
    html += '<div id="ant-tdr-parts-rows" style="display:flex;flex-direction:column;gap:8px">';
    parts.forEach(function (p) {
      var hasVal = !!String(p == null ? '' : p).trim();
      html += '<div style="display:flex;gap:6px;align-items:center">';
      html += '<input class="ant-tdr-part-input" type="text" placeholder="Part name + number (e.g. Ice maker W10250000)" value="' + escapeHtml(p) + '" style="' + PART_EDITOR_STYLE + ';flex:1;min-width:0">';
      // Existing (already-saved) parts get a remove button — clears the wrong one from
      // the warranty-parts log so it's actually gone (Teddy 2026-07-13: "needs to be
      // editable"). New/blank rows have nothing to remove.
      if (hasVal) html += '<button type="button" data-part="' + escapeHtml(p) + '" onclick="window.__antTdrRemovePart(this)" title="Remove this part" style="flex:0 0 auto;background:#2a1414;color:#ff7a7a;border:1px solid #5a2a2a;border-radius:9px;padding:11px 13px;font-size:15px;font-weight:800;cursor:pointer">🗑</button>';
      html += '</div>';
    });
    html += '</div>';
    html += '<button onclick="window.__antTdrAddPartRow()" style="margin-top:10px;background:#1a2233;color:#8fc0ff;border:1px dashed #3a4256;border-radius:10px;padding:12px;font-size:14px;font-weight:800;cursor:pointer;width:100%">+ add another part</button>';
    html += '<div class="ant-tdr-actions"><button class="ant-tdr-btn primary ant-tdr-save-btn" onclick="window.__antTdrSaveParts()" style="background:linear-gradient(135deg,#10b981,#047857)">✓ Save</button>';
    html += '<button class="ant-tdr-btn ghost" onclick="window.__antTdrCancelEdit()">Cancel</button></div>';
    host.innerHTML = html;
    var first = host.querySelector('.ant-tdr-part-input');
    if (first) { try { first.focus(); } catch (_) {} }
  };
  window.__antTdrAddPartRow = function () {
    var rows = document.getElementById('ant-tdr-parts-rows'); if (!rows) return;
    var inp = document.createElement('input');
    inp.className = 'ant-tdr-part-input';
    inp.type = 'text';
    inp.placeholder = 'Part name + number (e.g. Ice maker W10250000)';
    inp.setAttribute('style', PART_EDITOR_STYLE);
    rows.appendChild(inp);
    try { inp.focus(); } catch (_) {}
  };
  // Remove a wrong/mis-entered part from the warranty-parts log (soft delete — reversible).
  // Reads the part off the button's data attribute so odd characters (#, spaces) are safe.
  window.__antTdrRemovePart = async function (btn) {
    if (role !== 'tech' && role !== 'office') return;
    var part = btn && btn.getAttribute ? btn.getAttribute('data-part') : '';
    if (!part) return;
    if (!confirm('Remove this part?\n\n"' + String(part).slice(0, 90) + '"')) return;
    btn.disabled = true; btn.textContent = '…';
    try {
      await fetch('/.netlify/functions/warranty-parts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', job_id: Number(jobId), part: part, by: role, technician_id: techId ? Number(techId) : 0 }),
      });
      await loadSuppliedParts();     // pull the updated list
      window.__antTdrPartsEdit();    // re-render the editor with the part gone
    } catch (e) {
      btn.disabled = false; btn.textContent = '🗑';
      alert('Could not remove part: ' + (e && e.message ? e.message : e));
    }
  };
  window.__antTdrSaveParts = async function () {
    if (!lastData) return;
    var inputs = document.querySelectorAll('.ant-tdr-part-input');
    var vals = [];
    inputs.forEach(function (i) {
      var v = String(i.value == null ? '' : i.value).trim();
      if (v && vals.indexOf(v) === -1) vals.push(v);
    });
    var btns = document.querySelectorAll('.ant-tdr-save-btn');
    btns.forEach(function (b) { b.disabled = true; b.textContent = 'Saving…'; });
    // Persist each part to the warranty-parts event_log (this STICKS — the parts_needed
    // TDR column silently drops writes, which is why they used to vanish). Recorded as a
    // "used" write-in part (source tdr_used) so it counts toward 100% + shows in the parts
    // list. Only add parts not already on the list (dedup); removals are handled with the
    // Used/Return/Not-here buttons on each part below. (Jimmy's 75%-stuck bug, 2026-07-09.)
    var existing = usedPartsList();
    var toAdd = vals.filter(function (v) { return existing.indexOf(v) === -1; });
    try {
      for (var i = 0; i < toAdd.length; i++) {
        await fetch('/.netlify/functions/warranty-parts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: Number(jobId), part: toAdd[i], status: 'used', source: 'tdr_used', by: role, technician_id: techId ? Number(techId) : 0 }),
        });
      }
    } catch (e) {
      btns.forEach(function (b) { b.disabled = false; b.textContent = '✓ Save'; });
      alert('Could not save parts: ' + (e && e.message ? e.message : e));
      return;
    }
    // Best-effort: also write the legacy column (harmless no-op today; auto-populates if
    // the column type is ever fixed server-side). Never block the save on it.
    try {
      var body = { job_id: Number(jobId), field: 'parts_needed', value: vals.join('\n') };
      if (techId) body.technician_id = Number(techId);
      await fetch(XANO + '/update_tdr_field_from_voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (_) {}
    editKey = null;
    await loadSuppliedParts();   // pull the freshly-saved parts back
    await refresh();
    try { window.dispatchEvent(new Event('ant:state-changed')); } catch (_) {}
  };

  // Read the model # straight off the sticker PHOTO (customer's intake pic or the tech's)
  // via Claude Vision OCR — Teddy 2026-07-09: "the model should load from customer's pic or
  // tech's pic." Grabs the job's most-recent photo, runs ocr-model-extract, drops the code
  // into the input for the tech to confirm + Save.
  window.__antTdrReadModelPhoto = async function (btn) {
    var old = btn.textContent; btn.disabled = true; btn.textContent = '📷 Reading photo…';
    try {
      var a = await (await fetch(XANO + '/get_job_attachments?job_id=' + encodeURIComponent(jobId))).json();
      var atts = ((a && a.attachments) || []).filter(function (x) { return x.upload_complete_at; });
      // prefer an obvious model/photo image; else the most recent image on the job
      var img = atts.filter(function (x) { return /photo|image|model|sticker|jpg|jpeg|png|heic|webp/i.test(String(x.file_type || '') + String(x.s3_key || '') + String(x.mime_type || '')); }).slice(-1)[0]
        || atts.slice(-1)[0];
      if (!img) { alert('No photo on this job yet — snap the model sticker (or have the customer send one) and try again.'); btn.disabled = false; btn.textContent = old; return; }
      var sv = await (await fetch('/.netlify/functions/s3-view-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ s3_keys: [img.s3_key] }) })).json();
      var url = (((sv && sv.signed_urls) || [])[0] || {}).view_url;
      if (!url) { alert('Could not open the photo.'); btn.disabled = false; btn.textContent = old; return; }
      var oc = await (await fetch('/.netlify/functions/ocr-model-extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: Number(jobId), image_url: url, attachment_id: img.id }) })).json();
      var m = oc && oc.model_number;
      if (m) {
        var inp = document.getElementById('ant-tdr-model-input'); if (inp) inp.value = m;
        btn.textContent = '✓ Read: ' + m + ' — check it, then Save'; btn.disabled = false;
      } else {
        alert("Couldn't read a model # from that photo. Type it in, or snap a clearer picture of the sticker.");
        btn.disabled = false; btn.textContent = old;
      }
    } catch (e) { alert('Read failed: ' + (e && e.message ? e.message : e)); btn.disabled = false; btn.textContent = old; }
  };
  // Model # — its own editable spot on the TDR (Teddy 2026-07-09). Saves to the JOB
  // (update_job_basics.model_number) — the one record every surface + the warranty claim
  // reads — so the model # populates everywhere once the tech types it here.
  window.__antTdrModelEdit = function () {
    if (!lastData) return;
    if (role !== 'tech' && role !== 'office') return;
    editKey = 'model_number';
    var host = document.getElementById('ant-tdr-content'); if (!host) return;
    var cur = (((lastData.submission_extras || {}).model_number) || lastData.model_number || '').toString();
    var html = '';
    html += '<div class="ant-tdr-head"><div><div class="ant-tdr-title">Model #</div>';
    html += '<div class="ant-tdr-sub">Job #' + lastData.job_id + ' · ' + escapeHtml(lastData.appliance_summary || '') + '</div></div>';
    html += '<button class="ant-tdr-x" onclick="window.__antTdrCancelEdit()" title="cancel">×</button></div>';
    html += '<div style="background:rgba(74,158,255,0.12);border:1px solid rgba(74,158,255,0.4);color:#8fc0ff;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:700;margin-bottom:12px">🏷️ Read it straight off the model-sticker photo — or type it exactly as printed.</div>';
    html += '<button onclick="window.__antTdrReadModelPhoto(this)" style="width:100%;margin-bottom:10px;background:#132033;color:#8fc0ff;border:1px solid #34507e;border-radius:10px;padding:13px;font-size:14px;font-weight:800;cursor:pointer">📷 Read from the model photo</button>';
    html += '<input id="ant-tdr-model-input" type="text" value="' + escapeHtml(cur) + '" placeholder="e.g. WED4815EW1" style="' + PART_EDITOR_STYLE + '">';
    html += '<div class="ant-tdr-actions"><button class="ant-tdr-btn primary ant-tdr-save-btn" onclick="window.__antTdrSaveModel()" style="background:linear-gradient(135deg,#10b981,#047857)">✓ Save</button>';
    html += '<button class="ant-tdr-btn ghost" onclick="window.__antTdrCancelEdit()">Cancel</button></div>';
    host.innerHTML = html;
    var inp = document.getElementById('ant-tdr-model-input'); if (inp) { try { inp.focus(); } catch (_) {} }
  };
  window.__antTdrSaveModel = async function () {
    if (!lastData) return;
    var el = document.getElementById('ant-tdr-model-input');
    var val = el ? String(el.value || '').trim() : '';
    var btns = document.querySelectorAll('.ant-tdr-save-btn');
    btns.forEach(function (b) { b.disabled = true; b.textContent = 'Saving…'; });
    try {
      var wr = await fetch(XANO + '/update_job_basics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: Number(jobId), model_number: val }) });
      var wd = await wr.json();
      if (!wd || !wd.success) throw new Error((wd && (wd.message || wd.error)) || 'save failed');
    } catch (e) {
      btns.forEach(function (b) { b.disabled = false; b.textContent = '✓ Save'; });
      alert('Could not save model #: ' + (e && e.message ? e.message : e));
      return;
    }
    editKey = null;
    await refresh();
    try { window.dispatchEvent(new Event('ant:state-changed')); } catch (_) {}
  };

  // ── Job status — two-tap outcome (Teddy 2026-07-07): Job complete OR needs a second
  // trip. Saves to repair_completed so the rest of the system reads the outcome.
  window.__antTdrOutcomeEdit = function () {
    if (!lastData) return;
    if (role !== 'tech' && role !== 'office') return;
    editKey = 'repair_completed';
    var host = document.getElementById('ant-tdr-content'); if (!host) return;
    var cur = (((lastData.fields || {}).repair_completed || {}).value || '').toString();
    var isReassign = /reassign/i.test(cur);
    var isNotFix = /not fixable|no fix|not repairable|unrepairable|recommend replacement|replace the unit|not worth (repair|fixing)/i.test(cur);
    var isSecond = !isReassign && !isNotFix && /second trip|return visit|come back|not fixed|awaiting|waiting/i.test(cur);
    var isComplete = !isReassign && !isNotFix && !isSecond && cur.trim().length > 0;
    // Each choice: [which, label, active?, border-color, active-bg]
    var opts = [
      ['complete', '✅ Job complete', isComplete, '#10b981', 'linear-gradient(135deg,#10b981,#047857)'],
      ['second', '🔁 Needs a return visit', isSecond, '#f5a623', 'linear-gradient(135deg,#f5a623,#d98613)'],
      ['notfix', '♻️ Not fixable / recommend replacement', isNotFix, '#4aa9ff', 'linear-gradient(135deg,#4aa9ff,#1f6fed)'],
      ['reassign', '🔄 Please reassign', isReassign, '#a78bfa', 'linear-gradient(135deg,#a78bfa,#7c5cff)'],
    ];
    var html = '';
    html += '<div class="ant-tdr-head"><div><div class="ant-tdr-title">Job status</div>';
    html += '<div class="ant-tdr-sub">Job #' + lastData.job_id + ' · ' + escapeHtml(lastData.appliance_summary || '') + '</div></div>';
    html += '<button class="ant-tdr-x" onclick="window.__antTdrCancelEdit()" title="cancel">×</button></div>';
    html += '<div style="display:flex;flex-direction:column;gap:9px">';
    opts.forEach(function (o) {
      html += '<button onclick="window.__antTdrSaveOutcome(\'' + o[0] + '\')" style="text-align:left;background:' + (o[2] ? o[4] : '#0f1420') + ';color:#e6e9f0;border:1px solid ' + (o[2] ? o[3] : '#3a4256') + ';border-radius:12px;padding:15px;font-size:16px;font-weight:800;cursor:pointer">' + o[1] + '</button>';
    });
    html += '</div>';
    html += '<div style="margin-top:12px"><div style="font-size:12px;color:#8a92a6;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Note (optional)</div>';
    var strippedNote = cur.replace(/^(Job complete|Needs a second trip|Recommend replacement|Please reassign|Not fixable)[\s\-—:]*/i, '');
    html += '<textarea id="ant-tdr-outcome-note" rows="2" placeholder="e.g. what you did, why it needs replacing, or what the return trip needs" style="' + PART_EDITOR_STYLE + ';resize:vertical">' + escapeHtml(strippedNote) + '</textarea></div>';
    host.innerHTML = html;
  };
  window.__antTdrSaveOutcome = async function (which) {
    if (!lastData) return;
    // ALL 5 TDR fields must be filled (Teddy 2026-07-09). Completing REQUIRES all 5 — block
    // it and say what's missing. Other statuses save fine; they just won't celebrate unless
    // everything's filled.
    var _req = __antTdrRequiredCheck();
    if (which === 'complete' && !_req.ok) {
      alert('Finish the TDR to complete the job — still need:\n• ' + _req.missing.join('\n• '));
      return;
    }
    // Unlock audio INSIDE the tap gesture (before any await) so the celebration's cha-ching +
    // applause play on iOS too — only when we'll actually celebrate (all 5 filled).
    if (_req.ok && role === 'tech') { try { var _AC = window.AudioContext || window.webkitAudioContext; if (_AC) { window.__antAudioCtx = window.__antAudioCtx || new _AC(); if (window.__antAudioCtx.state === 'suspended') window.__antAudioCtx.resume(); } } catch (_) {} }
    var noteEl = document.getElementById('ant-tdr-outcome-note');
    var note = noteEl ? String(noteEl.value || '').trim() : '';
    var base = which === 'second' ? OUTCOME_SECOND_TRIP
      : which === 'notfix' ? OUTCOME_NOT_FIXABLE
      : which === 'reassign' ? OUTCOME_REASSIGN
      : OUTCOME_COMPLETE;
    // "Please reassign" sends the job back to the office (unassigns you) — confirm first.
    if (which === 'reassign' && !window.confirm('This sends the job back to the office to reassign — you\'ll be taken off it. Continue?')) return;
    var val = note ? (base + ' — ' + note) : base;
    try {
      var body = { job_id: Number(jobId), field: 'repair_completed', value: val };
      if (techId) body.technician_id = Number(techId);
      var wr = await fetch(XANO + '/update_tdr_field_from_voice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      var wd = await wr.json();
      if (!wd || !wd.success) throw new Error((wd && (wd.message || wd.error)) || 'save failed');
    } catch (e) {
      alert('Could not save: ' + (e && e.message ? e.message : e));
      return;
    }
    // Side effect: reassign kicks the job back to the office's Needs-Scheduled with the reason.
    if (which === 'reassign') {
      try {
        await fetch('/.netlify/functions/tech-request-reassignment', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: Number(jobId), technician_id: Number(techId) || 0, tdr_id: Number((lastData && lastData.tdr_id) || 0) || null, reason: val }),
        });
      } catch (_) {}
    }
    // Marking Job Complete must actually COMPLETE the job so it lands on the office Completed
    // tile — the TDR field write alone is side-effect-free. Flip scheduling_status to completed
    // (placeOf moves the card to the tech's Invoice/Completion tile) + fire the JOB_COMPLETED
    // cascade (warranty digest to Danielle, earnings). All 5 fields are verified filled above,
    // so this is a real, documented completion. (Teddy 2026-07-09: "confirm it all goes to the
    // office tile completed.")
    if (which === 'complete') {
      try { await fetch(XANO + '/office_set_job_status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: Number(jobId), scheduling_status: 'completed', actor: (role === 'office' ? 'office' : 'tech') }) }); } catch (_) {}
      try { await fetch(XANO + '/emit_colony_signal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signal_type: 'JOB_COMPLETED', signal_strength: 60, source_colony: 'tdr_card', target_colonies: '', payload: JSON.stringify({ job_id: Number(jobId), technician_id: Number(techId) || 0, source: 'tdr_complete' }) }) }); } catch (_) {}
    }
    // 🎉 THE CELEBRATION — fires on ANY status once all 5 fields are filled, for BOTH the tech
    // AND the office (Teddy 2026-07-09: "a similar celebration for office ... just no pay").
    // Pay tile + count + cha-ching = a TECH completing a job only; everything else (office
    // finishing it, or second-trip/not-fixable) gets confetti + check + applause, no pay.
    if (_req.ok && (role === 'tech' || role === 'office')) {
      try { window.__antTdrCelebrate({ appliance: (lastData && lastData.appliance_summary) || '', which: which, pay: (which === 'complete' && role === 'tech') }); } catch (_) {}
    }
    editKey = null;
    await refresh();
    try { window.dispatchEvent(new Event('ant:state-changed')); } catch (_) {}
  };

  // ── 🎉 COMPLETION CELEBRATION ────────────────────────────────────────────
  // Full-screen confetti + a giant animated checkmark + "done today" + the pay. Fires the
  // moment a tech marks a job complete. Self-contained (canvas confetti, SVG check — no deps).
  window.__antTdrCelebrate = function (opts) {
    opts = opts || {};
    if (document.getElementById('ant-tdr-celebrate')) return;
    var which = opts.which || 'complete';
    var isComplete = which === 'complete';
    var showPay = !!opts.pay;   // pay tile + count + cha-ching = a TECH completing a job only
    var HEAD = { complete: { tag: 'Job Complete', big: 'NICE WORK! 🎉' }, second: { tag: 'Second trip set', big: 'LOGGED! 🔁' }, notfix: { tag: 'Recommended replacement', big: 'LOGGED! ♻️' }, reassign: { tag: 'Report filed', big: 'SENT TO OFFICE 🔄' } };
    var _h = HEAD[which] || HEAD.complete;
    var reduce = false; try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
    var ov = document.createElement('div');
    ov.id = 'ant-tdr-celebrate';
    ov.setAttribute('style', 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:radial-gradient(1200px 820px at 50% 34%, rgba(16,185,129,0.30), rgba(6,10,18,0.95) 60%);opacity:0;transition:opacity .25s;font-family:-apple-system,system-ui,sans-serif;-webkit-tap-highlight-color:transparent;');
    ov.innerHTML =
      '<canvas id="ant-tdr-confetti" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></canvas>' +
      '<div style="position:relative;text-align:center;padding:24px;max-width:540px">' +
        '<div id="ant-tdr-badge" style="margin:0 auto 16px;width:136px;height:136px;transform:scale(0)">' +
          '<svg viewBox="0 0 120 120" width="136" height="136">' +
            '<circle cx="60" cy="60" r="54" fill="none" stroke="#10b981" stroke-width="8" stroke-linecap="round" stroke-dasharray="339" stroke-dashoffset="339" id="ant-tdr-ring" transform="rotate(-90 60 60)"/>' +
            '<path d="M36 62 L53 80 L86 43" fill="none" stroke="#4ade80" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="92" stroke-dashoffset="92" id="ant-tdr-check"/>' +
          '</svg>' +
        '</div>' +
        '<div style="font-size:14px;font-weight:900;letter-spacing:.2em;color:#4ade80;text-transform:uppercase">' + _h.tag + '</div>' +
        '<div style="font-size:42px;font-weight:900;color:#fff;line-height:1.05;margin-top:6px;text-shadow:0 4px 34px rgba(16,185,129,.55)">' + _h.big + '</div>' +
        (opts.appliance ? '<div style="font-size:15px;color:#b7f7d8;margin-top:8px;font-weight:700">' + escapeHtml(opts.appliance) + '</div>' : '') +
        (showPay ? ('<div style="display:flex;gap:12px;justify-content:center;margin-top:22px;flex-wrap:wrap">' +
          '<div style="background:rgba(255,255,255,.06);border:1px solid rgba(74,222,128,.4);border-radius:16px;padding:15px 22px;min-width:128px">' +
            '<div id="ant-tdr-cel-count" style="font-size:36px;font-weight:900;color:#fff">1</div>' +
            '<div style="font-size:11px;font-weight:800;letter-spacing:.08em;color:#7fe6ad;text-transform:uppercase">🔥 Done today</div>' +
          '</div>' +
          '<div style="background:rgba(255,255,255,.06);border:1px solid rgba(250,204,21,.45);border-radius:16px;padding:15px 22px;min-width:128px">' +
            '<div id="ant-tdr-cel-pay" style="font-size:36px;font-weight:900;color:#ffd94a">—</div>' +
            '<div id="ant-tdr-cel-paylbl" style="font-size:11px;font-weight:800;letter-spacing:.08em;color:#f2d47a;text-transform:uppercase">💰 Pay</div>' +
          '</div>' +
        '</div>') : '<div style="height:10px"></div>') +
        '<button onclick="window.__antTdrCelebrateClose()" style="margin-top:26px;background:linear-gradient(135deg,#10b981,#047857);color:#fff;border:0;border-radius:30px;padding:15px 32px;font-size:16px;font-weight:900;cursor:pointer;box-shadow:0 10px 30px rgba(16,185,129,.5)">Keep crushing it →</button>' +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.style.opacity = '1'; });
    var badge = document.getElementById('ant-tdr-badge');
    var ring = document.getElementById('ant-tdr-ring'), chk = document.getElementById('ant-tdr-check');
    if (badge) setTimeout(function () { badge.style.transition = 'transform .55s cubic-bezier(.2,1.5,.4,1)'; badge.style.transform = 'scale(1)'; }, 80);
    if (reduce) { if (ring) ring.style.strokeDashoffset = '0'; if (chk) chk.style.strokeDashoffset = '0'; }
    else {
      if (ring) { ring.style.transition = 'stroke-dashoffset .7s ease .15s'; setTimeout(function () { ring.style.strokeDashoffset = '0'; }, 160); }
      if (chk) { chk.style.transition = 'stroke-dashoffset .45s ease'; setTimeout(function () { chk.style.strokeDashoffset = '0'; }, 560); }
      __antTdrConfetti();
    }
    try { if (navigator.vibrate) navigator.vibrate([35, 55, 35, 55, 70]); } catch (_) {}
    if (showPay) { __antTdrCelebrateSound(); __antTdrCelebrateNumbers(); }
    else { __antTdrCelebrateApplauseOnly(); }
    ov._t = setTimeout(function () { window.__antTdrCelebrateClose(); }, 14000);
  };
  // Applause only (no cha-ching) — for non-"complete" statuses: they celebrate the finished
  // report, but there's no pay, so no money sound (Teddy 2026-07-09).
  function __antTdrCelebrateApplauseOnly() {
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { var ctx = window.__antAudioCtx || (window.__antAudioCtx = new AC()); if (ctx.state === 'suspended') ctx.resume(); __antTdrApplause(ctx, ctx.currentTime + 0.05, 1.6); } catch (_) {}
  }
  // 🔊 Cash-register cha-ching + a burst of applause — synthesized with Web Audio (no files,
  // works inside the Artifact/CSP). Teddy 2026-07-09: "cash register sounds ... an applause".
  function __antTdrCelebrateSound() {
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try {
      var ctx = window.__antAudioCtx || (window.__antAudioCtx = new AC());
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime;
      // cha-CHING: two bright ascending bell dings (fundamental + octave shimmer)
      function bell(freq, start, dur, gain) {
        var o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), g2 = ctx.createGain();
        o.type = 'triangle'; o.frequency.value = freq; o2.type = 'sine'; o2.frequency.value = freq * 2.01;
        o.connect(g); o2.connect(g2); g2.connect(g); g.connect(ctx.destination);
        g2.gain.value = 0.3;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(gain, start + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        o.start(start); o2.start(start); o.stop(start + dur); o2.stop(start + dur);
      }
      bell(1318.5, t, 0.5, 0.32);        // E6
      bell(1760.0, t + 0.11, 0.62, 0.38); // A6
      // register "ka" thunk
      var nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate), nd = nb.getChannelData(0);
      for (var i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nd.length, 2);
      var ns = ctx.createBufferSource(); ns.buffer = nb; var ng = ctx.createGain(); ng.gain.value = 0.22;
      var nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 1100;
      ns.connect(nf); nf.connect(ng); ng.connect(ctx.destination); ns.start(t);
      // applause: swelling bandpassed noise + random claps
      __antTdrApplause(ctx, t + 0.22, 1.9);
    } catch (_) {}
  }
  function __antTdrApplause(ctx, start, dur) {
    try {
      var len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0);
      for (var i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      var src = ctx.createBufferSource(); src.buffer = buf;
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.7;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(0.16, start + 0.35);
      g.gain.linearRampToValueAtTime(0.11, start + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      src.connect(bp); bp.connect(g); g.connect(ctx.destination);
      src.start(start); src.stop(start + dur);
      for (var k = 0; k < 16; k++) {
        var cs = ctx.createBufferSource(), cl = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.03), ctx.sampleRate), c = cl.getChannelData(0);
        for (var j = 0; j < c.length; j++) c[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / c.length, 3);
        cs.buffer = cl;
        var cg = ctx.createGain(); cg.gain.value = 0.05 + Math.random() * 0.05;
        var cf = ctx.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 1400 + Math.random() * 1600;
        cs.connect(cf); cf.connect(cg); cg.connect(ctx.destination); cs.start(start + Math.random() * dur * 0.85);
      }
    } catch (_) {}
  }
  window.__antTdrCelebrateClose = function () {
    var ov = document.getElementById('ant-tdr-celebrate'); if (!ov) return;
    if (ov._t) clearTimeout(ov._t);
    ov.style.opacity = '0';
    setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 260);
  };
  function __antTdrConfetti() {
    var cv = document.getElementById('ant-tdr-confetti'); if (!cv || !cv.getContext) return;
    var ctx = cv.getContext('2d');
    var W = cv.width = cv.offsetWidth, H = cv.height = cv.offsetHeight;
    var cols = ['#10b981', '#4ade80', '#ffd94a', '#38bdf8', '#f472b6', '#ffffff'];
    var N = Math.max(90, Math.min(200, Math.round(W / 5))), P = [];
    for (var i = 0; i < N; i++) P.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.6, r: 4 + Math.random() * 7, c: cols[(Math.random() * cols.length) | 0], vy: 2 + Math.random() * 4.5, vx: -2.5 + Math.random() * 5, rot: Math.random() * 6.28, vr: -0.25 + Math.random() * 0.5, sh: Math.random() < 0.5 ? 0 : 1 });
    var t0 = Date.now(), DUR = 3800;
    function frame() {
      var el = Date.now() - t0; ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < P.length; i++) { var p = P[i]; p.vy += 0.05; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - el / DUR);
        if (p.sh) ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.6); else { ctx.beginPath(); ctx.arc(0, 0, p.r / 1.6, 0, 6.28); ctx.fill(); }
        ctx.restore();
      }
      if (el < DUR && document.getElementById('ant-tdr-confetti')) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    }
    requestAnimationFrame(frame);
  }
  function __antTdrCountUp(el, to, prefix, dur) {
    if (!el) return; var t0 = Date.now();
    function step() { var pr = Math.min(1, (Date.now() - t0) / dur); var v = Math.round(to * (1 - Math.pow(1 - pr, 3))); el.textContent = (prefix || '') + (prefix === '$' ? v.toLocaleString() : v); if (pr < 1) requestAnimationFrame(step); }
    requestAnimationFrame(step);
  }
  async function __antTdrCelebrateNumbers() {
    var countEl = document.getElementById('ant-tdr-cel-count'), payEl = document.getElementById('ant-tdr-cel-pay'), payLbl = document.getElementById('ant-tdr-cel-paylbl');
    var count = 1, payVal = null, payLabel = 'Earned today';
    try {
      if (techId) {
        var e = await (await fetch('/.netlify/functions/tech-earnings?tech_id=' + encodeURIComponent(techId), { cache: 'no-store' })).json();
        var jobs = (e && e.jobs) || [];
        var todayCT = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
        var todays = jobs.filter(function (j) { var w = j.when ? new Date(j.when) : null; return w && !isNaN(w) && w.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) === todayCT; });
        var here = todays.some(function (j) { return Number(j.job_id) === Number(jobId); });
        count = todays.length + (here ? 0 : 1);
        var thisJob = jobs.filter(function (j) { return Number(j.job_id) === Number(jobId); })[0];
        var todayPay = todays.reduce(function (s, j) { return s + (Number(j.pay) || 0); }, 0);
        if (thisJob && Number(thisJob.pay) > 0) { payVal = Number(thisJob.pay); payLabel = 'On this job'; }
        else if (todayPay > 0) { payVal = todayPay; payLabel = 'Earned today'; }
        else if (e && Number(e.owed) > 0) { payVal = Number(e.owed); payLabel = 'Owed to you'; }
      }
    } catch (_) {}
    __antTdrCountUp(countEl, count, '', 750);
    if (payVal != null) { __antTdrCountUp(payEl, Math.round(payVal), '$', 950); if (payLbl) payLbl.textContent = '💰 ' + payLabel; }
    else { if (payEl) payEl.textContent = '✓'; if (payLbl) payLbl.textContent = '💰 Logged'; }
  }

  // Inline field editing — tap a TDR field, edit right in the card, save.
  // No jump to another page. Empty diagnosis pre-fills from the customer's
  // own complaint (the tech confirms/corrects instead of typing from zero).
  window.__antTdrEdit = function (key) {
    if (!lastData) return;
    var meta = FIELD_META[key]; if (!meta) return;
    if (role !== 'tech' && role !== 'office') return;
    editKey = key;
    var host = document.getElementById('ant-tdr-content'); if (!host) return;
    var fields = lastData.fields || {};
    var cur = ((fields[key] || {}).value || '').toString();
    var seededNote = '';
    if (key === 'diagnosis' && !cur.trim()) {
      var complaint = ((lastData.submission_extras || {}).problem_summary || '').toString().trim();
      if (complaint) { cur = complaint; seededNote = 'Pre-filled from what the customer told us — confirm or edit.'; }
    }
    var editorStyle = 'width:100%;box-sizing:border-box;background:#0f1420;color:#e6e9f0;border:1px solid #3a4256;border-radius:12px;padding:13px 14px;font-size:16px;font-family:-apple-system,sans-serif;line-height:1.4;outline:none';
    var inputHtml = meta.multiline
      ? '<textarea id="ant-tdr-edit-input" rows="5" placeholder="' + escapeHtml(meta.ph) + '" style="' + editorStyle + ';resize:vertical">' + escapeHtml(cur) + '</textarea>'
      : '<input id="ant-tdr-edit-input" type="text"' + (meta.numeric ? ' inputmode="decimal"' : '') + ' placeholder="' + escapeHtml(meta.ph) + '" value="' + escapeHtml(cur) + '" style="' + editorStyle + '">';
    var html = '';
    html += '<div class="ant-tdr-head"><div><div class="ant-tdr-title">Edit ' + escapeHtml(meta.label) + '</div>';
    html += '<div class="ant-tdr-sub">Job #' + lastData.job_id + ' · ' + escapeHtml(lastData.appliance_summary || '') + '</div></div>';
    // Green ✓ Save in the header so it is ALWAYS visible above the phone keyboard — the
    // bottom Save was getting hidden by the keyboard, so techs only saw the × and used
    // that. Now the green check is the obvious save; × cancels. (Teddy 7/6.)
    html += '<div style="display:flex;gap:8px;align-items:center;flex:0 0 auto">';
    html += '<button class="ant-tdr-save-btn" onclick="window.__antTdrSaveField()" style="background:linear-gradient(135deg,#10b981,#047857);color:#fff;border:0;border-radius:10px;padding:11px 18px;font-size:15px;font-weight:800;cursor:pointer;white-space:nowrap">✓ Save</button>';
    html += '<button class="ant-tdr-x" onclick="window.__antTdrCancelEdit()" title="cancel — do not save">×</button>';
    html += '</div></div>';
    if (seededNote) html += '<div style="background:rgba(74,158,255,0.12);border:1px solid rgba(74,158,255,0.4);color:#8fc0ff;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:700;margin-bottom:12px">📩 ' + escapeHtml(seededNote) + '</div>';
    html += inputHtml;
    html += '<div class="ant-tdr-actions"><button class="ant-tdr-btn primary ant-tdr-save-btn" onclick="window.__antTdrSaveField()" style="background:linear-gradient(135deg,#10b981,#047857)">✓ Save</button>';
    html += '<button class="ant-tdr-btn ghost" onclick="window.__antTdrCancelEdit()">Cancel</button></div>';
    host.innerHTML = html;
    var inp = document.getElementById('ant-tdr-edit-input');
    if (inp) { inp.focus(); try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (_) {} }
  };
  window.__antTdrCancelEdit = function () { editKey = null; if (lastData) renderModal(lastData); };
  window.__antTdrSaveField = async function () {
    var key = editKey; var meta = FIELD_META[key];
    if (!key || !meta || !lastData) return;
    var inp = document.getElementById('ant-tdr-edit-input');
    var val = inp ? String(inp.value == null ? '' : inp.value).trim() : '';
    var btns = document.querySelectorAll('.ant-tdr-save-btn');
    btns.forEach(function (b) { b.disabled = true; b.textContent = 'Saving…'; });
    try {
      // update_tdr_field_from_voice upserts the in-progress TDR by (job_id,
      // technician_id) and writes via db.edit — no TDR_SUBMITTED signal, so
      // editing a field never autonomously moves the job. It takes the same
      // field keys this card uses (diagnosis / failed_component / labor_hours /
      // repair_completed / parts_needed).
      var body = { job_id: Number(jobId), field: key, value: val };
      if (techId) body.technician_id = Number(techId);
      var wr = await fetch(XANO + '/update_tdr_field_from_voice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      var wd = await wr.json();
      if (!wd || !wd.success) throw new Error((wd && (wd.message || wd.error)) || 'save failed');
    } catch (e) {
      btns.forEach(function (b) { b.disabled = false; b.textContent = '✓ Save'; });
      alert('Could not save: ' + (e && e.message ? e.message : e));
      return;
    }
    editKey = null;
    await refresh();
    try { window.dispatchEvent(new Event('ant:state-changed')); } catch (_) {}
  };
  window.__antTdrOpenTeddy = function () {
    location.href = '/teddy-tdr-tool.html?job_id=' + jobId;
  };
  window.__antTdrSubmitWarranty = function () {
    if (!lastData) { alert('No data loaded yet'); return; }
    var pkg = buildSubmissionPackage(lastData);
    tdrCopyToClipboard(pkg);
    var vendor = lastData.warranty_company || '';
    var portal = tdrPortalUrlForVendor(vendor);
    // Show a confirmation banner inside the modal sheet so the user
    // sees what just happened before any redirect.
    var content = document.getElementById('ant-tdr-content');
    if (content) {
      var banner = document.createElement('div');
      banner.style.cssText = 'position:sticky;top:0;background:linear-gradient(135deg,#10b981,#047857);color:#fff;padding:14px 16px;border-radius:12px;margin-bottom:14px;font-weight:700;font-size:14px;display:flex;align-items:center;gap:10px;box-shadow:0 4px 14px rgba(16,185,129,0.35);z-index:10';
      banner.innerHTML = '<span style="font-size:20px">📋</span><span>Submission package copied to clipboard. ' + (portal ? 'Opening ' + vendor + ' portal in new tab — paste it in.' : 'Paste it into the vendor portal.') + '</span>';
      content.insertBefore(banner, content.firstChild);
      setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 6000);
    }
    if (portal) {
      setTimeout(function () { window.open(portal, '_blank', 'noopener'); }, 350);
    }
  };

  // ── Boot timing ────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
