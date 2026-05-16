const BUTTON_ID = "veritas-video-check-button";
const OVERLAY_ID = "veritas-segment-overlay";
const MAX_SEGMENT = 30; // seconds

let activeVideo = null;

// ─── utilities ────────────────────────────────────────────────────────────────

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ─── video detection ──────────────────────────────────────────────────────────

function getVideoInfo(video) {
  const rect = video.getBoundingClientRect();
  return {
    sourceUrl: video.currentSrc || video.src || "",
    pageUrl: window.location.href,
    pageHost: window.location.host,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function getBestVideo() {
  if (activeVideo) return activeVideo;
  return [...document.querySelectorAll("video")]
    .filter((v) => {
      const r = v.getBoundingClientRect();
      return r.width > 120 && r.height > 90;
    })
    .sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    })[0] ?? null;
}

function buildFileName(mimeType) {
  const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("quicktime") ? "mov" : "mp4";
  return `veritas-selected-video.${ext}`;
}

// ─── hover button ─────────────────────────────────────────────────────────────

function getButton() {
  let btn = document.getElementById(BUTTON_ID);
  if (btn) return btn;

  btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.type = "button";
  btn.textContent = "Verify with Veritas";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const video = getBestVideo();
    if (!video) return;
    showSegmentOverlay(video);
  });
  document.documentElement.appendChild(btn);
  return btn;
}

function showButton(video) {
  activeVideo = video;
  const rect = video.getBoundingClientRect();
  const btn = getButton();
  // position: fixed — rect coords are already viewport coords, no scroll offset needed
  btn.style.left = `${Math.max(8, rect.right - 164)}px`;
  btn.style.top = `${Math.max(8, rect.top + 8)}px`;
  btn.style.opacity = "1";
  btn.style.pointerEvents = "auto";
}

function showButtonError(msg) {
  const btn = getButton();
  const prev = btn.textContent;
  btn.textContent = msg;
  btn.style.opacity = "1";
  btn.style.pointerEvents = "auto";
  btn.style.left = "12px";
  btn.style.top = `${Math.max(12, window.scrollY + 12)}px`;
  setTimeout(() => {
    btn.textContent = prev;
    btn.style.opacity = "0";
    btn.style.pointerEvents = "none";
  }, 3500);
}

// ─── segment overlay (minimal bottom bar) ────────────────────────────────────

function removeSegmentOverlay() {
  document.getElementById(OVERLAY_ID)?.remove();
}

function showSegmentOverlay(video) {
  removeSegmentOverlay();

  const duration = video.duration;
  if (!duration || !isFinite(duration)) {
    showButtonError("Duration unknown.");
    return;
  }

  const segLen = Math.min(MAX_SEGMENT, duration);
  let inPoint = Math.max(0, (duration - segLen) / 2);
  let outPoint = inPoint + segLen;
  let dragging = null;

  // ── root ──────────────────────────────────────────────────────────────────

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;";

  // ── styles ────────────────────────────────────────────────────────────────

  const style = document.createElement("style");
  style.textContent = `
    #${OVERLAY_ID} * { box-sizing: border-box; }
    #${OVERLAY_ID} .vrt-bar {
      position: fixed;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 12px;
      height: 52px;
      background: linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0) 100%);
      pointer-events: auto;
    }
    #${OVERLAY_ID} .vrt-track {
      flex: 1;
      position: relative;
      height: 4px;
      background: rgba(255,255,255,0.22);
      border-radius: 2px;
    }
    #${OVERLAY_ID} .vrt-fill {
      position: absolute;
      top: 0; height: 100%;
      background: #3b82f6;
      border-radius: 2px;
      pointer-events: none;
    }
    #${OVERLAY_ID} .vrt-handle {
      position: absolute; top: 50%;
      width: 12px; height: 20px;
      transform: translate(-50%, -50%);
      background: #fff;
      border-radius: 3px;
      cursor: ew-resize;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4);
    }
    #${OVERLAY_ID} .vrt-handle::after { content: ''; position: absolute; inset: -8px; }
    #${OVERLAY_ID} .vrt-hlabel {
      position: absolute; bottom: 22px;
      transform: translateX(-50%);
      font-size: 10px;
      color: rgba(255,255,255,0.75);
      white-space: nowrap;
      pointer-events: none;
    }
    #${OVERLAY_ID} .vrt-badge {
      font: 600 11px/1 system-ui,-apple-system,sans-serif;
      color: rgba(255,255,255,0.65);
      white-space: nowrap;
      min-width: 28px;
    }
    #${OVERLAY_ID} .vrt-badge.warn { color: #fbbf24; }
    #${OVERLAY_ID} .vrt-btn {
      padding: 5px 10px;
      border-radius: 5px;
      cursor: pointer;
      font: 600 11px/1 system-ui,-apple-system,sans-serif;
      border: none;
      white-space: nowrap;
      flex-shrink: 0;
    }
    #${OVERLAY_ID} .vrt-btn-clip  { background: #3b82f6; color: #fff; }
    #${OVERLAY_ID} .vrt-btn-clip:hover  { background: #2563eb; }
    #${OVERLAY_ID} .vrt-btn-cancel {
      background: rgba(255,255,255,0.1);
      color: rgba(255,255,255,0.65);
      border: 1px solid rgba(255,255,255,0.18);
    }
    #${OVERLAY_ID} .vrt-loading {
      display: flex;
      align-items: center;
      gap: 9px;
      color: rgba(255,255,255,0.8);
      font: 12px/1 system-ui,-apple-system,sans-serif;
    }
    @keyframes vrt-spin { to { transform: rotate(360deg); } }
    #${OVERLAY_ID} .vrt-spinner {
      width: 16px; height: 16px;
      border: 2px solid rgba(59,130,246,0.3);
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: vrt-spin 0.75s linear infinite;
      flex-shrink: 0;
    }
  `;
  overlay.appendChild(style);

  // ── bar ───────────────────────────────────────────────────────────────────

  const bar = document.createElement("div");
  bar.className = "vrt-bar";
  bar.innerHTML = `
    <div class="vrt-track" id="vrt-track">
      <div class="vrt-fill"   id="vrt-fill"></div>
      <div class="vrt-handle" id="vrt-hin"  data-handle="in">
        <span class="vrt-hlabel" id="vrt-lin"></span>
      </div>
      <div class="vrt-handle" id="vrt-hout" data-handle="out">
        <span class="vrt-hlabel" id="vrt-lout"></span>
      </div>
    </div>
    <span class="vrt-badge" id="vrt-badge"></span>
    <button class="vrt-btn vrt-btn-clip"   id="vrt-clip">Clip</button>
    <button class="vrt-btn vrt-btn-cancel" id="vrt-xout">✕</button>
  `;
  overlay.appendChild(bar);
  document.documentElement.appendChild(overlay);

  // ── position ──────────────────────────────────────────────────────────────

  function positionBar() {
    const r = video.getBoundingClientRect();
    bar.style.left   = `${r.left}px`;
    bar.style.width  = `${r.width}px`;
    bar.style.top    = `${r.bottom - 52}px`;
    bar.style.bottom = "auto";
  }
  positionBar();
  requestAnimationFrame(positionBar);

  // ── refs ──────────────────────────────────────────────────────────────────

  const track     = bar.querySelector("#vrt-track");
  const fill      = bar.querySelector("#vrt-fill");
  const hIn       = bar.querySelector("#vrt-hin");
  const hOut      = bar.querySelector("#vrt-hout");
  const lIn       = bar.querySelector("#vrt-lin");
  const lOut      = bar.querySelector("#vrt-lout");
  const badge     = bar.querySelector("#vrt-badge");
  const clipBtn   = bar.querySelector("#vrt-clip");
  const cancelBtn = bar.querySelector("#vrt-xout");

  // ── UI ────────────────────────────────────────────────────────────────────

  function updateUI() {
    const inPct  = (inPoint  / duration) * 100;
    const outPct = (outPoint / duration) * 100;
    hIn.style.left   = `${inPct}%`;
    hOut.style.left  = `${outPct}%`;
    fill.style.left  = `${inPct}%`;
    fill.style.width = `${outPct - inPct}%`;
    lIn.textContent  = fmt(inPoint);
    lOut.textContent = fmt(outPoint);
    const seg = Math.round(outPoint - inPoint);
    badge.textContent = `${seg}s`;
    badge.className = seg >= MAX_SEGMENT ? "vrt-badge warn" : "vrt-badge";
  }
  updateUI();

  // ── drag ──────────────────────────────────────────────────────────────────

  function pctAt(e) {
    const r = track.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1);
  }

  overlay.addEventListener("mousedown", (e) => {
    const h = e.target.closest("[data-handle]");
    if (!h) return;
    e.preventDefault();
    dragging = h.dataset.handle;
  });

  function onMove(e) {
    if (!dragging) return;
    const t = pctAt(e) * duration;
    if (dragging === "in") {
      inPoint = clamp(t, 0, outPoint - 1);
      if (outPoint - inPoint > MAX_SEGMENT) outPoint = inPoint + MAX_SEGMENT;
    } else {
      outPoint = clamp(t, inPoint + 1, duration);
      if (outPoint - inPoint > MAX_SEGMENT) inPoint = outPoint - MAX_SEGMENT;
    }
    updateUI();
  }

  function onUp() { dragging = null; }
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);

  // ── cleanup ───────────────────────────────────────────────────────────────

  function cleanup() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    window.removeEventListener("scroll", positionBar, true);
    window.removeEventListener("resize", positionBar);
    removeSegmentOverlay();
  }

  cancelBtn.addEventListener("click", cleanup);

  window.addEventListener("scroll", positionBar, { passive: true, capture: true });
  window.addEventListener("resize", positionBar, { passive: true });

  const mo = new MutationObserver(() => {
    if (!document.getElementById(OVERLAY_ID)) {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      window.removeEventListener("scroll", positionBar, true);
      window.removeEventListener("resize", positionBar);
      mo.disconnect();
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: false });

  // ── clip ──────────────────────────────────────────────────────────────────

  clipBtn.addEventListener("click", async () => {
    // Switch bar to loading state
    bar.innerHTML = `
      <div class="vrt-loading">
        <div class="vrt-spinner"></div>
        <span id="vrt-progress">Starting…</span>
      </div>
    `;
    const progressEl = bar.querySelector("#vrt-progress");
    const setProgress = (msg) => { if (progressEl) progressEl.textContent = msg; };

    const sendJob = (status, extra = {}) =>
      browser.runtime.sendMessage({ type: "VERITAS_UPDATE_SEGMENT_JOB", status, ...extra }).catch(() => {});

    try {
      // Open popup first so the user sees it load (may fail if no user-gesture scope)
      await browser.runtime.sendMessage({ type: "VERITAS_START_SEGMENT_JOB" }).catch(() => {});

      // Record
      const blob = await recordSegment(video, inPoint, outPoint, (msg) => {
        setProgress(msg);
        sendJob("recording", { progress: msg });
      });

      setProgress("Verifying…");
      sendJob("verifying", { progress: "Verifying…" });

      const buffer = await blob.arrayBuffer();
      const result = await browser.runtime.sendMessage({
        type: "VERITAS_VERIFY_BLOB",
        payload: { buffer, name: "segment.webm", type: blob.type || "video/webm" },
      });

      // Keep buffer available for context analysis if the video wasn't verified.
      // Firefox uses structured clone for sendMessage so buffer is still valid here.
      if (result?.status !== "verified") {
        browser.runtime.sendMessage({
          type: "VERITAS_STORE_ANALYSIS_BLOB",
          payload: { buffer, name: "segment.webm", type: blob.type || "video/webm" },
        }).catch(() => {});
      }

      sendJob("done", { result });
      cleanup();
    } catch (err) {
      sendJob("error", { error: err.message || "Verification failed." });
      cleanup();
    }
  });
}

// ─── segment recording ────────────────────────────────────────────────────────

async function recordSegment(video, inPoint, outPoint, onProgress) {
  const captureFn = video.captureStream ?? video.mozCaptureStream;
  if (typeof captureFn !== "function") {
    throw new Error("captureStream() is not available on this video element.");
  }

  const wasPaused = video.paused;

  onProgress?.("Seeking to start of segment…");
  video.currentTime = inPoint;
  await new Promise((resolve, reject) => {
    const onSeeked = () => { video.removeEventListener("error", onErr); resolve(); };
    const onErr    = () => { video.removeEventListener("seeked", onSeeked); reject(new Error("Seek failed.")); };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onErr, { once: true });
  });

  const mimeType = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"]
    .find((t) => MediaRecorder.isTypeSupported(t)) ?? "";

  const stream   = captureFn.call(video);
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  const chunks   = [];

  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  return new Promise((resolve, reject) => {
    let tick = null;

    recorder.onstop = () => {
      clearInterval(tick);
      stream.getTracks().forEach((t) => t.stop());
      if (wasPaused) video.pause();
      const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
      if (!blob.size) {
        reject(new Error("Recorded segment is empty. The video may be DRM-protected."));
      } else {
        resolve(blob);
      }
    };

    recorder.onerror = (e) => {
      clearInterval(tick);
      reject(e.error ?? new Error("MediaRecorder error."));
    };

    video.play().catch((err) => {
      clearInterval(tick);
      reject(err);
    });
    recorder.start(250);

    const total = outPoint - inPoint;
    onProgress?.(`Recording 0 / ${Math.round(total)}s…`);

    tick = setInterval(() => {
      const elapsed = Math.max(0, video.currentTime - inPoint);
      onProgress?.(`Recording ${Math.round(elapsed)} / ${Math.round(total)}s…`);
      if (video.currentTime >= outPoint || video.ended) {
        clearInterval(tick);
        recorder.stop();
      }
    }, 250);
  });
}

// ─── message handler ──────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "VERITAS_SHOW_SEGMENT_OVERLAY") {
    const video = getBestVideo();
    if (!video) return Promise.resolve({ ok: false, error: "No video found on this page." });
    showSegmentOverlay(video);
    return Promise.resolve({ ok: true });
  }

  if (message?.type === "VERITAS_GET_SELECTED_VIDEO_INFO") {
    const video = getBestVideo();
    return Promise.resolve({
      ok: Boolean(video),
      info: video ? getVideoInfo(video) : null,
      error: video ? null : "No playable video was found on this page.",
    });
  }

  if (message?.type === "VERITAS_EXTRACT_SELECTED_VIDEO") {
    const video = getBestVideo();
    if (!video) return Promise.resolve({ ok: false, error: "No playable video found." });

    const sourceUrl = video.currentSrc || video.src || "";
    if (!sourceUrl || sourceUrl.startsWith("blob:")) {
      return Promise.resolve({
        ok: false,
        isBlob: true,
        error: "This video uses a streaming blob URL. Hover over the video and click \"Verify with Veritas\" to use the segment selector.",
        info: getVideoInfo(video),
      });
    }

    return fetch(sourceUrl)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
      .then(async (blob) => ({
        ok: true,
        payload: {
          name: buildFileName(blob.type),
          type: blob.type || "video/mp4",
          buffer: await blob.arrayBuffer(),
          info: getVideoInfo(video),
        },
      }))
      .catch((err) => ({ ok: false, error: err.message, info: getVideoInfo(video) }));
  }

  return undefined;
});

// ─── init ─────────────────────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById("veritas-video-check-styles")) return;
  const style = document.createElement("style");
  style.id = "veritas-video-check-styles";
  style.textContent = `
    #${BUTTON_ID} {
      position: fixed;
      z-index: 2147483647;
      border: 1px solid rgba(255,255,255,0.35);
      border-radius: 6px;
      background: rgba(15,23,42,0.94);
      color: white;
      cursor: pointer;
      font: 600 12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      padding: 8px 10px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 120ms ease;
    }
  `;
  document.documentElement.appendChild(style);
}

injectStyles();

// Use elementsFromPoint so the button appears even when X/Twitter/TikTok overlay
// divs sit on top of the video element and intercept pointer events.
{
  let lastVideo = null;
  let hideTimer = null;
  let rafPending = false;

  document.addEventListener("mousemove", (e) => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; });

    const video = document.elementsFromPoint(e.clientX, e.clientY)
      .find((el) => el instanceof HTMLVideoElement && el.getBoundingClientRect().width > 120);

    if (video) {
      clearTimeout(hideTimer);
      hideTimer = null;
      if (video !== lastVideo) {
        lastVideo = video;
        showButton(video);
      }
    } else if (!document.getElementById(BUTTON_ID)?.matches(":hover")) {
      if (!hideTimer) {
        hideTimer = setTimeout(() => {
          const btn = document.getElementById(BUTTON_ID);
          if (btn) { btn.style.opacity = "0"; btn.style.pointerEvents = "none"; }
          activeVideo = null;
          lastVideo = null;
          hideTimer = null;
        }, 200);
      }
    }
  }, { passive: true });
}
