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
  // Tech vs Ant 🐜 (Stage 1): antGuess undefined=unfetched, null=no confident call, obj=call.
  var antGuess, antGuessBasedOn = 0, antGuessVerdict = null, antGuessOverriding = false, antGuessLoading = false;
  // The 5 inline-editable TDR fields → their real DB column + editor shape.
  var FIELD_META = {
    diagnosis:        { label: 'Diagnosis',        col: 'diagnosis',        multiline: true,  ph: 'What is wrong with it?' },
    failed_component: { label: 'Failed Component', col: 'failed_component', multiline: false, ph: 'Which part failed?' },
    labor_hours:      { label: 'Labor Hours',      col: 'labor_time_hours', multiline: false, ph: 'e.g. 1.5', numeric: true },
    repair_completed: { label: 'Repair Done',      col: 'repair_completed', multiline: true,  ph: 'What did you do to fix it?' },
    parts_needed:     { label: 'Parts Used',       col: 'parts_needed',     multiline: true,  ph: 'Parts swapped in (or "none")' },
  };

  // ── Boot ───────────────────────────────────────────────────────────
  function init() {
    var p = new URLSearchParams(location.search);
    jobId = p.get('job_id') || p.get('job') || '';
    techId = p.get('tech_id') || '';
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
      '#ant-tdr-sheet { background: #131720; color: #e6e9f0; width: 100%; max-width: 540px; max-height: 88vh; border-radius: 22px 22px 0 0; padding: 22px 18px 32px; overflow-y: auto; font-family: -apple-system, sans-serif; animation: antTdrSlide 0.28s ease-out; }',
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

  function openModal() {
    var back = document.getElementById('ant-tdr-backdrop');
    if (back) back.classList.add('open');
    refresh();
  }
  function closeModal() {
    var back = document.getElementById('ant-tdr-backdrop');
    if (back) back.classList.remove('open');
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
    if (pctEl) pctEl.textContent = (d.readiness_pct || 0) + '%';
    if (btn) {
      if (d.readiness_pct >= 100) btn.classList.add('ready');
      else btn.classList.remove('ready');
    }
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
    var pct = d.readiness_pct || 0;
    var ready = pct >= 100;
    var customerSafe = false;
    var blockingText = buildBlockingText(d);

    var fieldOrder = [
      {key: 'diagnosis',        label: 'Diagnosis',        icon: '🔍', prompt: 'Tell Ant what\'s wrong'},
      {key: 'failed_component', label: 'Failed Component', icon: '⚙️', prompt: 'Which part failed?'},
      {key: 'labor_hours',      label: 'Labor Hours',      icon: '⏱️', prompt: 'Total time on the job'},
      {key: 'repair_completed', label: 'Repair Done',      icon: '🔧', prompt: 'What did you do to fix it?'},
      {key: 'parts_needed',     label: 'Parts Used',       icon: '📦', prompt: 'Parts swapped in (or "none")'},
    ];
    var photoFilled = !!d.has_photo;

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
      var editable = canEdit && !!FIELD_META[f.key] && f.key !== 'parts_needed';
      var cls = fState.filled ? 'filled' : 'empty';
      var icon = fState.filled ? '✅' : '⏳';
      html += '<div class="ant-tdr-field ' + cls + '"' + (editable ? ' style="cursor:pointer" onclick="window.__antTdrEdit(\'' + f.key + '\')"' : '') + '>';
      html += '<div class="ant-tdr-field-icon">' + icon + '</div>';
      html += '<div class="ant-tdr-field-body">';
      html += '<div class="ant-tdr-field-label">' + escapeHtml(f.label)
        + (editable ? '<span style="float:right;color:#7fa8d8;font-weight:700;letter-spacing:0">' + (fState.filled ? '✏️ edit' : '✏️ add') + '</span>' : '') + '</div>';
      if (fState.filled) {
        html += '<div class="ant-tdr-field-value">' + escapeHtml(String(fState.value)) + '</div>';
      } else {
        html += '<div class="ant-tdr-field-empty-prompt">' + escapeHtml(f.prompt) + '</div>';
      }
      html += '</div></div>';
    });
    // Photo row
    var photoIcon = photoFilled ? '✅' : '📷';
    var photoCls = photoFilled ? 'filled' : 'empty';
    html += '<div class="ant-tdr-field ' + photoCls + '">';
    html += '<div class="ant-tdr-field-icon">' + photoIcon + '</div>';
    html += '<div class="ant-tdr-field-body">';
    html += '<div class="ant-tdr-field-label">Photos</div>';
    if (photoFilled) {
      html += '<div class="ant-tdr-field-value">' + (d.attachments_count || 0) + ' on file</div>';
    } else {
      html += '<div class="ant-tdr-field-empty-prompt">At least one photo required for warranty</div>';
    }
    html += '</div></div>';
    // Signature row
    var sigFilled = !!d.has_signature;
    var sigIcon = sigFilled ? '✅' : '✍️';
    var sigCls = sigFilled ? 'filled' : 'empty';
    html += '<div class="ant-tdr-field ' + sigCls + '">';
    html += '<div class="ant-tdr-field-icon">' + sigIcon + '</div>';
    html += '<div class="ant-tdr-field-body">';
    html += '<div class="ant-tdr-field-label">Customer Signature</div>';
    if (sigFilled) {
      html += '<div class="ant-tdr-field-value">Signed on file</div>';
    } else {
      html += '<div class="ant-tdr-field-empty-prompt">Customer needs to sign on the tech\'s phone</div>';
    }
    html += '</div></div>';
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
    add('failed_component', ex.failed_component);
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
    var labels = {
      diagnosis: 'diagnosis',
      failed_component: 'failed part',
      labor_hours: 'labor hours',
      repair_completed: 'repair description',
      parts_needed: 'parts used',
      photo: 'photo',
      signature: 'signature',
    };
    var missing = [];
    for (var k in b) {
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
