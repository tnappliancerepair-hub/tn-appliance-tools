// Tech-side upload reliability layer. The "lawsuit insurance":
// every photo/video saved to IndexedDB BEFORE upload starts, kept there
// until S3 confirms receipt via HEAD. Retries on failure with backoff.
// Auto-resumes on page load / online event / tab-visible / 60s timer.
//
// Why: tech videos are evidence in warranty disputes + lawsuits. If a
// cell signal drops mid-upload and we lose the file, we lose the case.
// This layer guarantees: once a tech taps "send", the file exists durably
// on this device until it exists in S3.
//
// Storage: IndexedDB. Blob stored as ArrayBuffer (more reliable on iOS
// Safari than Blob). Quota: ~50% of disk on iOS, request persistent so
// iOS won't evict under pressure.
//
// API:
//   const uq = new UploadQueue({ jobId, techId, xanoBase, netlifyBase, onUpdate });
//   await uq.init();
//   await uq.enqueue(file, { fileType: 'photo'|'video' });
//   const stats = uq.getStats();   // { pending, uploading, failed, completed_session }
//   uq.retry(id);                  // manually retry one item
//   uq.processAll();               // kick the queue
(function () {
  'use strict';
  if (window.UploadQueue) return;

  const DB_NAME = 'tn-tech-uploads';
  const DB_VERSION = 1;
  const STORE_NAME = 'pending';
  const MAX_CONCURRENT = 1;             // 1 at a time to avoid swamping LTE
  const MAX_ATTEMPTS = 8;
  const BACKOFF_MS = [5_000, 15_000, 60_000, 5*60_000, 15*60_000, 30*60_000, 60*60_000, 2*60*60_000];
  const RETRY_INTERVAL_MS = 60_000;     // background tick every minute

  // ── IndexedDB helpers ─────────────────────────────────────────────
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('status', 'status');
          store.createIndex('created_at', 'created_at');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function tx(db, mode) { return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME); }
  function put(db, item) { return new Promise((res, rej) => { const r = tx(db,'readwrite').put(item); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }
  function get(db, id) { return new Promise((res, rej) => { const r = tx(db,'readonly').get(id); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
  function del(db, id) { return new Promise((res, rej) => { const r = tx(db,'readwrite').delete(id); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }
  function getAll(db) { return new Promise((res, rej) => { const r = tx(db,'readonly').getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }); }

  // ── Helpers ───────────────────────────────────────────────────────
  function uuid() {
    return 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }
  async function fileToArrayBuffer(file) {
    return await file.arrayBuffer();
  }
  function arrayBufferToBlob(buf, mime) {
    return new Blob([buf], { type: mime || 'application/octet-stream' });
  }

  class UploadQueue {
    constructor(opts) {
      this.jobId = opts.jobId;
      this.techId = opts.techId;
      this.xanoBase = opts.xanoBase;
      this.netlifyBase = opts.netlifyBase;
      this.onUpdate = opts.onUpdate || (() => {});
      this.db = null;
      this.activeUploads = new Map();      // id → AbortController
      this.completedSession = 0;
      this._processing = false;
      this._retryTimer = null;
    }

    async init() {
      this.db = await openDB();
      // Request persistent storage so iOS Safari doesn't evict under pressure.
      // Silently fails on browsers without the API — that's fine.
      if (navigator.storage && navigator.storage.persist) {
        try { await navigator.storage.persist(); } catch (_) {}
      }
      // Auto-resume on online / visibility / interval.
      window.addEventListener('online', () => this.processAll());
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) this.processAll();
      });
      this._retryTimer = setInterval(() => this.processAll(), RETRY_INTERVAL_MS);
      // Kick off on init in case there's leftover queue from prior session.
      await this.processAll();
      this.onUpdate();
    }

    async enqueue(file, meta = {}) {
      const id = uuid();
      const buf = await fileToArrayBuffer(file);
      const item = {
        id,
        file_buf: buf,
        file_name: file.name || 'upload',
        file_size: file.size,
        file_type: meta.fileType || (file.type.startsWith('video/') ? 'video' : 'photo'),
        mime: file.type || 'application/octet-stream',
        job_id: this.jobId,
        tech_id: this.techId,
        status: 'queued',                // queued | uploading | uploaded | failed
        attempts: 0,
        last_error: null,
        created_at: Date.now(),
        s3_key: null,
        attachment_id: null,
        progress_pct: 0,
      };
      await put(this.db, item);
      this.onUpdate();
      this.processAll();
      return id;
    }

    async getStats() {
      const all = await getAll(this.db);
      return {
        pending: all.filter(x => x.status === 'queued').length,
        uploading: all.filter(x => x.status === 'uploading').length,
        failed: all.filter(x => x.status === 'failed').length,
        completed_session: this.completedSession,
        total_in_queue: all.length,
      };
    }

    async list() {
      const all = await getAll(this.db);
      return all.sort((a, b) => a.created_at - b.created_at);
    }

    async retry(id) {
      const item = await get(this.db, id);
      if (!item) return;
      item.status = 'queued';
      item.attempts = 0;
      item.last_error = null;
      await put(this.db, item);
      this.onUpdate();
      this.processAll();
    }

    async cancel(id) {
      const ac = this.activeUploads.get(id);
      if (ac) { try { ac.abort(); } catch (_) {} this.activeUploads.delete(id); }
      await del(this.db, id);
      this.onUpdate();
    }

    async processAll() {
      if (this._processing) return;
      this._processing = true;
      try {
        while (true) {
          if (this.activeUploads.size >= MAX_CONCURRENT) break;
          if (!navigator.onLine) break;
          const all = await getAll(this.db);
          // Pick the oldest queued item not currently uploading; skip failed
          // items still in backoff window.
          const now = Date.now();
          const next = all
            .filter(x => x.status === 'queued' || (x.status === 'failed' && this._backoffDue(x, now)))
            .sort((a, b) => a.created_at - b.created_at)[0];
          if (!next) break;
          // Mark uploading + spawn (don't await — concurrency handled by activeUploads count)
          next.status = 'uploading';
          await put(this.db, next);
          this._upload(next);   // fire-and-monitor
          this.onUpdate();
        }
      } finally {
        this._processing = false;
      }
    }

    _backoffDue(item, now) {
      const lastAttemptAt = item.last_attempt_at || item.created_at;
      const idx = Math.min(item.attempts - 1, BACKOFF_MS.length - 1);
      const delay = BACKOFF_MS[Math.max(0, idx)];
      return (now - lastAttemptAt) >= delay;
    }

    async _upload(item) {
      const ac = new AbortController();
      this.activeUploads.set(item.id, ac);

      const finish = async (patch) => {
        Object.assign(item, patch);
        await put(this.db, item);
        this.activeUploads.delete(item.id);
        this.onUpdate();
        // Keep going.
        setTimeout(() => this.processAll(), 100);
      };

      const fail = async (errMsg) => {
        const attempts = item.attempts + 1;
        const status = attempts >= MAX_ATTEMPTS ? 'failed_permanent' : 'failed';
        await finish({
          status,
          attempts,
          last_error: String(errMsg || 'unknown'),
          last_attempt_at: Date.now(),
        });
      };

      try {
        // 1. generate_upload_url (Xano) — gets s3_key + attachment_id
        const xanoRes = await fetch(`${this.xanoBase}/generate_upload_url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_id: parseInt(this.jobId, 10),
            attachment_type: 'tdr',
            file_type: item.file_type,
            original_filename: item.file_name,
            mime_type: item.mime,
            uploaded_by: 'tech',
            tech_id: parseInt(this.techId, 10),
          }),
          signal: ac.signal,
        });
        if (!xanoRes.ok) throw new Error(`Xano ${xanoRes.status}`);
        const xanoData = await xanoRes.json();
        if (!xanoData.success) throw new Error('Xano returned no success');
        item.s3_key = xanoData.s3_key;
        item.attachment_id = xanoData.attachment_id;

        // 2. s3-presign (Netlify) — gets upload_url
        const presignRes = await fetch(`${this.netlifyBase}/.netlify/functions/s3-presign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ s3_key: item.s3_key, mime_type: item.mime }),
          signal: ac.signal,
        });
        if (!presignRes.ok) throw new Error(`Presign ${presignRes.status}`);
        const presignData = await presignRes.json();
        if (!presignData.success) throw new Error('Presign no success');

        // 3. PUT to S3 (with progress via XHR — fetch lacks upload progress)
        await this._putToS3(presignData.upload_url, item, ac);

        // 4. VERIFY via HEAD — the lawsuit-insurance step. Don't trust
        //    PUT 200; confirm the bytes actually landed.
        const headRes = await fetch(presignData.upload_url, {
          method: 'HEAD',
          signal: ac.signal,
        });
        if (!headRes.ok) throw new Error(`S3 HEAD verify failed ${headRes.status}`);
        const contentLength = parseInt(headRes.headers.get('content-length') || '0', 10);
        if (contentLength > 0 && contentLength !== item.file_size) {
          throw new Error(`S3 size mismatch: got ${contentLength} expected ${item.file_size}`);
        }

        // 5. save_attachment (Xano) — finalize record
        await fetch(`${this.xanoBase}/save_attachment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attachment_id: item.attachment_id,
            file_size_bytes: item.file_size,
          }),
          signal: ac.signal,
        });

        // 6. ALL DONE. Remove from local cache — S3 has it, verified.
        await del(this.db, item.id);
        this.activeUploads.delete(item.id);
        this.completedSession++;
        this.onUpdate();
        if (typeof item.on_complete === 'function') {
          try { item.on_complete(); } catch (_) {}
        }
        // Fire a window event other code can listen to.
        window.dispatchEvent(new CustomEvent('upload-verified', { detail: { id: item.id, attachment_id: item.attachment_id, file_type: item.file_type, file_name: item.file_name } }));
        setTimeout(() => this.processAll(), 100);
      } catch (err) {
        if (err.name === 'AbortError') {
          // User canceled — already handled in cancel().
          return;
        }
        await fail(err.message || err);
      }
    }

    _putToS3(url, item, ac) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const blob = arrayBufferToBlob(item.file_buf, item.mime);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            // Update progress in DB sparingly (every 5%) to avoid IDB write spam
            if (pct - (item.progress_pct || 0) >= 5 || pct === 100) {
              item.progress_pct = pct;
              put(this.db, item).then(() => this.onUpdate()).catch(() => {});
            }
          }
        };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('S3 PUT ' + xhr.status));
        xhr.onerror = () => reject(new Error('S3 PUT network error'));
        xhr.ontimeout = () => reject(new Error('S3 PUT timeout'));
        xhr.timeout = 10 * 60 * 1000;   // 10 min cap per file — even a 200MB video on 1 Mbps fits
        ac.signal.addEventListener('abort', () => { try { xhr.abort(); } catch (_) {} });
        xhr.open('PUT', url);
        xhr.setRequestHeader('Content-Type', item.mime);
        xhr.send(blob);
      });
    }
  }

  window.UploadQueue = UploadQueue;
})();
