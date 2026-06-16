/* ant-video-upload.js — ONE resilient video uploader for customers AND techs.
 *
 * Tries Cloudflare Stream first (resumable tus upload — survives dropped signal,
 * resumes instead of restarting, handles long/large videos). If Stream isn't
 * configured yet, or anything fails, it falls back to the page-provided S3
 * uploader so the funnel never breaks.
 *
 *   AntVideo.upload(file, {
 *     convId, jobId, uploadedBy,           // linkage + who uploaded
 *     onStatus(phase, attempt, pct),       // 'preparing'|'uploading'|'retry'|'done'|'failed'
 *     s3Fallback(file) -> Promise<{ok}>,   // page's existing S3 path (optional)
 *   }) -> Promise<{ ok, via:'stream'|'s3', uid? }>
 */
(function () {
  var FN = 'https://tnapplianceexchange.net/.netlify/functions';
  var TUS_SRC = 'https://cdn.jsdelivr.net/npm/tus-js-client@4/dist/tus.min.js';
  var tusReady = null;

  function loadTus() {
    if (window.tus) return Promise.resolve(window.tus);
    if (tusReady) return tusReady;
    tusReady = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = TUS_SRC; sc.async = true;
      sc.onload = function () { window.tus ? resolve(window.tus) : reject(new Error('tus missing')); };
      sc.onerror = function () { reject(new Error('tus load failed')); };
      document.head.appendChild(sc);
    });
    return tusReady;
  }

  function postJSON(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }

  function streamUpload(file, opts) {
    var onStatus = opts.onStatus || function () {};
    return loadTus().then(function (tus) {
      onStatus('preparing', 1, 0);
      return postJSON(FN + '/stream-direct-upload', {
        bytes: file.size, filename: file.name || 'video.mp4',
        conversation_id: opts.convId || null, job_id: opts.jobId || null,
        uploaded_by: opts.uploadedBy || 'customer',
      }).then(function (d) {
        if (!d || !d.ok || !d.uploadUrl) { var e = new Error('fallback'); e.fallback = true; throw e; }
        return new Promise(function (resolve, reject) {
          var up = new tus.Upload(file, {
            uploadUrl: d.uploadUrl,            // tokenless one-time URL → PATCH/resume directly
            chunkSize: 50 * 1024 * 1024,        // 50MB chunks (min 5MB); a dropped chunk retries, not the whole file
            retryDelays: [0, 2000, 4000, 8000, 16000, 30000, 45000],  // keep trying on weak signal
            metadata: { filename: file.name || 'video.mp4', filetype: file.type || 'video/mp4' },
            onProgress: function (sent, total) { onStatus('uploading', 1, total ? sent / total : 0); },
            onError: function (err) { reject(err); },
            onSuccess: function () { onStatus('done', 1, 1); resolve({ ok: true, via: 'stream', uid: d.uid }); },
          });
          up.start();
        });
      });
    });
  }

  function upload(file, opts) {
    opts = opts || {};
    var onStatus = opts.onStatus || function () {};
    return streamUpload(file, opts).catch(function () {
      // Stream not configured or failed — use the page's S3 uploader if provided.
      if (typeof opts.s3Fallback === 'function') {
        return Promise.resolve(opts.s3Fallback(file)).then(function (r) {
          return { ok: !!(r && r.ok !== false), via: 's3' };
        });
      }
      onStatus('failed', 1, 0);
      return { ok: false, via: 'none' };
    });
  }

  window.AntVideo = { upload: upload };

  // ── PHOTO: Cloudflare Images (reliable infra + CDN), S3 fallback ────────────
  function postForm(url, file) {
    var fd = new FormData(); fd.append('file', file, file.name || 'photo.jpg');
    return fetch(url, { method: 'POST', body: fd });
  }
  function imageUpload(file, opts) {
    var onStatus = opts.onStatus || function () {};
    onStatus('preparing', 1, 0);
    return postJSON(FN + '/images-direct-upload', {
      conversation_id: opts.convId || null, job_id: opts.jobId || null,
      uploaded_by: opts.uploadedBy || 'customer',
    }).then(function (d) {
      if (!d || !d.ok || !d.uploadURL) { var e = new Error('fallback'); e.fallback = true; throw e; }
      // small files — retry the whole POST a few times on weak signal
      var tries = 4;
      function attempt(n) {
        onStatus('uploading', n, 0.5);
        return postForm(d.uploadURL, file).then(function (r) {
          if (!r.ok) throw new Error('cf-img ' + r.status);
          onStatus('done', n, 1);
          return { ok: true, via: 'cfimages', deliveryUrl: d.deliveryUrl, id: d.id };
        }).catch(function (err) {
          if (n < tries) { onStatus('retry', n, 0); return new Promise(function (res) { setTimeout(res, Math.min(2000 * n, 8000)); }).then(function () { return attempt(n + 1); }); }
          throw err;
        });
      }
      return attempt(1);
    });
  }
  function uploadPhoto(file, opts) {
    opts = opts || {};
    var onStatus = opts.onStatus || function () {};
    return imageUpload(file, opts).catch(function () {
      if (typeof opts.s3Fallback === 'function') {
        return Promise.resolve(opts.s3Fallback(file)).then(function (r) { return { ok: !!(r && r.ok !== false), via: 's3' }; });
      }
      onStatus('failed', 1, 0);
      return { ok: false, via: 'none' };
    });
  }
  window.AntPhoto = { upload: uploadPhoto };
})();
