// CaptureOverlay — proven photo/video capture overlay used on the public
// website (index.html) since 2026-05. Extracted to its own asset on
// 2026-05-28 so the new tech-ant-chat.html (and any future Ant surface)
// can rely on the same code path the public chat has been hardening for
// months.
//
// Public API:
//   window.CaptureOverlay.openPhotoCapture(onComplete)
//   window.CaptureOverlay.openVideoCapture(onComplete)
//
// onComplete fires exactly once with (blob, mimeType) on "Use",
// (null, null) on cancel/error.
//
// Video is hard-capped at 10s MP4 (or webm fallback) which keeps blobs
// small enough to upload from a single bar of LTE.
//
// Self-installing IIFE — load once per page via:
//   <script src="/capture-overlay.js?v=1"></script>

(function() {
  let overlay = null;
  let videoEl = null;
  let playbackEl = null;
  let photoEl = null;
  let toolbarEl = null;
  let countdownEl = null;
  let recDotEl = null;
  let errorEl = null;
  let errorMsgEl = null;
  let errorHintEl = null;
  let modeLabelEl = null;

  let stream = null;
  let recorder = null;
  let chunks = [];
  let countdownTimer = null;
  let recordedBlob = null;
  let recordedUrl = null;

  let mode = null;
  let state = 'closed';
  let onCompleteFn = null;
  let completed = false;
  let fallbackInput = null;

  function ext(msg, isErr) {
    if (isErr) console.error('[CaptureOverlay]', msg); else console.log('[CaptureOverlay]', msg);
  }

  function ensureOverlay() {
    if (overlay) return;

    const styleTag = document.createElement('style');
    styleTag.textContent = `
      @keyframes co-pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }
      #capture-overlay video, #capture-overlay img { -webkit-user-select: none; user-select: none; }
      #capture-overlay button { -webkit-tap-highlight-color: transparent; }
    `;
    document.head.appendChild(styleTag);

    overlay = document.createElement('div');
    overlay.id = 'capture-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0;
      background: #000; z-index: 99999;
      display: none; flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #fff;
    `;
    overlay.innerHTML = `
      <div id="co-topbar" style="display:flex;justify-content:space-between;align-items:center;padding:max(12px,env(safe-area-inset-top)) 16px 12px 16px;background:rgba(0,0,0,0.55);">
        <div id="co-mode-label" style="font-size:14px;font-weight:600;letter-spacing:0.3px;">—</div>
        <button id="co-close" type="button" aria-label="Cancel" style="background:rgba(255,255,255,0.2);color:#fff;border:0;width:38px;height:38px;border-radius:19px;font-size:22px;line-height:1;cursor:pointer;padding:0;">×</button>
      </div>

      <div id="co-stage" style="flex:1;position:relative;display:flex;align-items:center;justify-content:center;background:#000;overflow:hidden;min-height:0;">
        <video id="co-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;display:none;"></video>
        <video id="co-playback" controls playsinline style="width:100%;height:100%;object-fit:contain;display:none;background:#000;"></video>
        <img id="co-photo" alt="" style="width:100%;height:100%;object-fit:contain;display:none;background:#000;">

        <div id="co-countdown" style="position:absolute;top:16px;left:50%;transform:translateX(-50%);font-size:72px;font-weight:800;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,0.8);display:none;line-height:1;">10</div>

        <div id="co-rec-dot" style="position:absolute;top:20px;right:16px;display:none;align-items:center;gap:6px;background:rgba(0,0,0,0.55);padding:6px 12px;border-radius:14px;font-size:12px;font-weight:700;letter-spacing:0.5px;">
          <span style="width:10px;height:10px;border-radius:50%;background:#dc3545;animation:co-pulse 1s infinite;"></span><span>REC</span>
        </div>

        <div id="co-error" style="display:none;padding:24px;text-align:center;max-width:340px;">
          <div style="font-size:56px;margin-bottom:12px;">⚠️</div>
          <div id="co-error-msg" style="font-size:16px;line-height:1.4;margin-bottom:8px;color:#fff;font-weight:600;">Camera permission denied.</div>
          <div id="co-error-hint" style="font-size:13px;color:#bbb;margin-bottom:20px;line-height:1.5;"></div>
          <button id="co-error-retry" type="button" style="display:block;width:100%;padding:13px;background:#007bff;color:#fff;border:0;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:10px;">Retry camera</button>
          <button id="co-error-fallback" type="button" style="display:block;width:100%;padding:13px;background:#6c757d;color:#fff;border:0;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;">Or pick from gallery</button>
        </div>
      </div>

      <div id="co-toolbar" style="padding:14px 16px max(14px,env(safe-area-inset-bottom)) 16px;background:rgba(0,0,0,0.7);display:flex;justify-content:center;align-items:center;gap:16px;min-height:80px;"></div>
    `;
    document.body.appendChild(overlay);

    videoEl    = overlay.querySelector('#co-video');
    playbackEl = overlay.querySelector('#co-playback');
    photoEl    = overlay.querySelector('#co-photo');
    toolbarEl  = overlay.querySelector('#co-toolbar');
    countdownEl= overlay.querySelector('#co-countdown');
    recDotEl   = overlay.querySelector('#co-rec-dot');
    errorEl    = overlay.querySelector('#co-error');
    errorMsgEl = overlay.querySelector('#co-error-msg');
    errorHintEl= overlay.querySelector('#co-error-hint');
    modeLabelEl= overlay.querySelector('#co-mode-label');

    overlay.querySelector('#co-close').addEventListener('click', cancel);
    overlay.querySelector('#co-error-retry').addEventListener('click', () => {
      ext('Retry camera tapped');
      hideError();
      startStream();
    });
    overlay.querySelector('#co-error-fallback').addEventListener('click', openFallbackPicker);
  }

  function pickVideoMimeType() {
    const candidates = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=h264,aac',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    for (const c of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }

  function showOverlay() { overlay.style.display = 'flex'; }
  function hideOverlay() { overlay.style.display = 'none'; }

  function showLive() {
    videoEl.style.display = 'block';
    playbackEl.style.display = 'none';
    photoEl.style.display = 'none';
    errorEl.style.display = 'none';
  }
  function showPlayback() {
    videoEl.style.display = 'none';
    playbackEl.style.display = 'block';
    photoEl.style.display = 'none';
    errorEl.style.display = 'none';
  }
  function showPhoto() {
    videoEl.style.display = 'none';
    playbackEl.style.display = 'none';
    photoEl.style.display = 'block';
    errorEl.style.display = 'none';
  }
  function showError(visible) {
    if (visible) {
      videoEl.style.display = 'none';
      playbackEl.style.display = 'none';
      photoEl.style.display = 'none';
      errorEl.style.display = 'block';
    } else {
      errorEl.style.display = 'none';
    }
  }
  function hideError() { showError(false); }

  function renderToolbarReady() {
    toolbarEl.innerHTML = '';
    if (mode === 'video') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = 'background:#dc3545;color:#fff;border:0;border-radius:36px;padding:14px 28px;font-size:16px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:10px;';
      btn.innerHTML = '<span style="width:14px;height:14px;border-radius:50%;background:#fff;display:inline-block;"></span> Record 10s';
      btn.addEventListener('click', startRecording);
      toolbarEl.appendChild(btn);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Capture photo');
      btn.style.cssText = 'background:#fff;border:6px solid rgba(255,255,255,0.4);border-radius:50%;width:74px;height:74px;cursor:pointer;padding:0;';
      btn.addEventListener('click', capturePhoto);
      toolbarEl.appendChild(btn);
    }
  }
  function renderToolbarRecording() {
    toolbarEl.innerHTML = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'background:#dc3545;color:#fff;border:0;border-radius:36px;padding:14px 28px;font-size:16px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:10px;';
    btn.innerHTML = '<span style="width:14px;height:14px;background:#fff;display:inline-block;"></span> Stop';
    btn.addEventListener('click', stopRecording);
    toolbarEl.appendChild(btn);
  }
  function renderToolbarReview() {
    toolbarEl.innerHTML = '';
    const useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.textContent = 'Use This';
    useBtn.style.cssText = 'background:#28a745;color:#fff;border:0;border-radius:8px;padding:14px 22px;font-size:16px;font-weight:700;cursor:pointer;flex:1;';
    useBtn.addEventListener('click', useResult);

    const retakeBtn = document.createElement('button');
    retakeBtn.type = 'button';
    retakeBtn.textContent = 'Retake';
    retakeBtn.style.cssText = 'background:#6c757d;color:#fff;border:0;border-radius:8px;padding:14px 22px;font-size:16px;font-weight:700;cursor:pointer;flex:1;';
    retakeBtn.addEventListener('click', retake);

    toolbarEl.appendChild(retakeBtn);
    toolbarEl.appendChild(useBtn);
  }
  function renderToolbarEmpty() { toolbarEl.innerHTML = ''; }

  async function startStream() {
    state = 'opening';
    renderToolbarEmpty();
    hideError();

    const constraints = mode === 'video'
      ? { video: { facingMode: { ideal: 'environment' } }, audio: true }
      : { video: { facingMode: { ideal: 'environment' } }, audio: false };

    try {
      ext('Requesting camera (' + mode + ' mode)...');
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      ext('Permission granted; tracks: ' + stream.getTracks().map(t => t.kind).join(','));

      videoEl.srcObject = stream;
      try { await videoEl.play(); } catch (e) { ext('preview play warn: ' + e.message, true); }

      showLive();
      state = 'ready';
      renderToolbarReady();
    } catch (err) {
      ext('getUserMedia failed: ' + err.name + ': ' + err.message, true);
      handleStreamError(err);
    }
  }

  function handleStreamError(err) {
    state = 'error';
    let msg = 'Camera unavailable.';
    let hint = '';
    if (err.name === 'NotAllowedError') {
      msg = 'Camera permission denied.';
      hint = 'Settings → Safari → Camera + Microphone, then reload.';
    } else if (err.name === 'NotFoundError') {
      msg = 'No camera found on this device.';
      hint = 'You can still pick a file from your gallery.';
    } else if (err.name === 'NotReadableError') {
      msg = 'Camera is in use by another app.';
      hint = 'If you are on a phone call, hang up and tap Retry.';
    } else if (err.name === 'OverconstrainedError') {
      msg = 'Back camera not available.';
      hint = 'Tap Retry — we will try the front camera instead.';
    } else {
      hint = err.message;
    }
    errorMsgEl.textContent = msg;
    errorHintEl.textContent = hint;
    showError(true);
    renderToolbarEmpty();
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    if (videoEl) videoEl.srcObject = null;
  }

  function startRecording() {
    if (state !== 'ready' || !stream) return;
    chunks = [];
    const mimeType = pickVideoMimeType();
    ext('Starting recording, mimeType: ' + (mimeType || '(default)'));

    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (e) {
      ext('MediaRecorder ctor failed: ' + e.message + ' — retrying default', true);
      try { recorder = new MediaRecorder(stream); }
      catch (e2) { ext('MediaRecorder unavailable: ' + e2.message, true); openFallbackPicker(); return; }
    }

    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    recorder.onerror = (e) => { ext('Recorder error: ' + (e.error ? e.error.name : '?'), true); };
    recorder.onstop = onRecorderStop;

    recorder.start(250);
    state = 'recording';
    recDotEl.style.display = 'flex';
    countdownEl.style.display = 'block';
    countdownEl.textContent = '10';
    renderToolbarRecording();

    let secondsLeft = 10;
    countdownTimer = setInterval(() => {
      secondsLeft--;
      countdownEl.textContent = secondsLeft;
      if (secondsLeft <= 0) {
        clearInterval(countdownTimer); countdownTimer = null;
        ext('10s reached, auto-stopping');
        stopRecording();
      }
    }, 1000);
  }

  function stopRecording() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch (e) { ext('recorder.stop error: ' + e.message, true); }
    }
  }

  function onRecorderStop() {
    countdownEl.style.display = 'none';
    recDotEl.style.display = 'none';

    const type = (recorder && recorder.mimeType) || (chunks[0] && chunks[0].type) || 'video/webm';
    recordedBlob = new Blob(chunks, { type });
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    recordedUrl = URL.createObjectURL(recordedBlob);
    ext('Video blob: ' + recordedBlob.size + ' bytes, type=' + recordedBlob.type);

    stopStream();
    playbackEl.src = recordedUrl;
    showPlayback();
    state = 'review';
    renderToolbarReview();
  }

  function capturePhoto() {
    if (state !== 'ready' || !stream) return;
    const w = videoEl.videoWidth || 1280;
    const h = videoEl.videoHeight || 720;
    if (!w || !h) { ext('Video dimensions not ready, retrying soon', true); setTimeout(capturePhoto, 100); return; }

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, w, h);

    canvas.toBlob((blob) => {
      if (!blob) { ext('canvas.toBlob returned null', true); return; }
      recordedBlob = blob;
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      recordedUrl = URL.createObjectURL(recordedBlob);
      ext('Photo blob: ' + recordedBlob.size + ' bytes, type=' + recordedBlob.type + ', dim=' + w + 'x' + h);

      stopStream();
      photoEl.src = recordedUrl;
      showPhoto();
      state = 'review';
      renderToolbarReview();
    }, 'image/jpeg', 0.9);
  }

  function useResult() {
    if (!recordedBlob) { ext('useResult called with no blob', true); return; }
    finishAndCallback(recordedBlob, recordedBlob.type);
  }

  function retake() {
    ext('Retake');
    if (recordedUrl) { URL.revokeObjectURL(recordedUrl); recordedUrl = null; }
    recordedBlob = null;
    chunks = [];
    playbackEl.src = '';
    photoEl.src = '';
    startStream();
  }

  function cancel() {
    if (completed) return;
    ext('Canceled');
    finishAndCallback(null, null);
  }

  function finishAndCallback(blob, mimeType) {
    if (completed) return;
    completed = true;
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    stopStream();
    if (recordedUrl && !blob) { URL.revokeObjectURL(recordedUrl); recordedUrl = null; }
    hideOverlay();
    state = 'closed';
    const cb = onCompleteFn;
    onCompleteFn = null;
    chunks = [];
    if (cb) {
      try { cb(blob, mimeType); } catch (e) { console.error('onComplete handler threw:', e); }
    }
  }

  function openFallbackPicker() {
    if (!fallbackInput) {
      fallbackInput = document.createElement('input');
      fallbackInput.type = 'file';
      fallbackInput.style.display = 'none';
      document.body.appendChild(fallbackInput);
    }
    fallbackInput.accept = mode === 'video' ? 'video/*' : 'image/*';
    fallbackInput.value = '';
    fallbackInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) { ext('Fallback picker canceled'); cancel(); return; }
      ext('Fallback picker selected: ' + file.name + ', ' + file.size + ', ' + file.type);
      finishAndCallback(file, file.type || (mode === 'video' ? 'video/mp4' : 'image/jpeg'));
    };
    fallbackInput.click();
  }

  function open(forMode, onComplete) {
    if (state !== 'closed' && state !== 'error') {
      ext('open() called while state=' + state + ', refusing', true);
      return;
    }
    mode = forMode;
    onCompleteFn = (typeof onComplete === 'function') ? onComplete : null;
    completed = false;
    recordedBlob = null;
    chunks = [];

    ensureOverlay();
    modeLabelEl.textContent = mode === 'video' ? 'Record video' : 'Take photo';
    renderToolbarEmpty();
    showOverlay();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      handleStreamError({ name: 'NotSupportedError', message: 'getUserMedia not available' });
      return;
    }
    if (mode === 'video' && typeof MediaRecorder === 'undefined') {
      handleStreamError({ name: 'NotSupportedError', message: 'MediaRecorder not available' });
      return;
    }

    startStream();
  }

  window.CaptureOverlay = {
    openVideoCapture: function(onComplete) { open('video', onComplete); },
    openPhotoCapture: function(onComplete) { open('photo', onComplete); }
  };
})();
