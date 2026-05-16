const VERITAS_BASE_URL = "http://localhost:3000";

let popupIntent   = null;
let segmentJob    = null; // null | { status, progress?, result?, error? }
let analysisBlob  = null; // last unverified segment, kept for "Find info" analysis
let textJob       = null; // null | { status, text?, result?, error? }

// ─── context menu ─────────────────────────────────────────────────────────────

browser.contextMenus.removeAll().then(() => {
  browser.contextMenus.create({
    id: "veritas-clip-segment",
    title: "Clip & verify with Veritas",
    contexts: ["all"],
  });
  browser.contextMenus.create({
    id: "veritas-verify-text",
    title: "Verify news from text",
    contexts: ["selection"],
  });
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "veritas-clip-segment" && tab?.id) {
    browser.tabs.sendMessage(tab.id, { type: "VERITAS_SHOW_SEGMENT_OVERLAY" }).catch(() => {});
  }

  if (info.menuItemId === "veritas-verify-text") {
    const text = info.selectionText?.trim();
    if (text) startTextAnalysis(text);
  }
});

// ─── message handler ──────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "VERITAS_OPEN_EXTENSION_POPUP") {
    popupIntent = {
      autoVerify: Boolean(message.autoVerify),
      tabId: sender.tab?.id ?? null,
      requestedAt: Date.now(),
    };
    return openExtensionPopup();
  }

  if (message?.type === "VERITAS_GET_POPUP_INTENT") {
    const intent = popupIntent;
    popupIntent = null;
    return Promise.resolve(intent);
  }

  if (message?.type === "VERITAS_VERIFY_BLOB") {
    return verifyBlob(message.payload);
  }

  // ── segment job lifecycle ──────────────────────────────────────────────────

  if (message?.type === "VERITAS_GET_TEXT_JOB") {
    return Promise.resolve(textJob);
  }

  if (message?.type === "VERITAS_START_SEGMENT_JOB") {
    segmentJob   = { status: "recording", progress: "Recording…" };
    analysisBlob = null; // discard any stale blob from a previous recording
    textJob      = null; // clear any stale text analysis
    openExtensionPopup().catch(() => {});
    return Promise.resolve({ ok: true });
  }

  if (message?.type === "VERITAS_UPDATE_SEGMENT_JOB") {
    segmentJob = {
      status: message.status,
      progress: message.progress ?? segmentJob?.progress,
      result: message.result ?? null,
      error: message.error ?? null,
      hasAnalysisBlob: segmentJob?.hasAnalysisBlob ?? false,
    };
    return Promise.resolve({ ok: true });
  }

  if (message?.type === "VERITAS_GET_SEGMENT_JOB") {
    return Promise.resolve(segmentJob);
  }

  if (message?.type === "VERITAS_STORE_ANALYSIS_BLOB") {
    analysisBlob = message.payload ?? null;
    // Flag the current job so the popup knows a blob is ready
    if (segmentJob) segmentJob.hasAnalysisBlob = true;
    return Promise.resolve({ ok: true });
  }

  if (message?.type === "VERITAS_ANALYZE_SEGMENT") {
    if (!analysisBlob?.buffer) {
      return Promise.reject(new Error("No segment is available for analysis."));
    }
    return analyzeSegment(analysisBlob);
  }

  return undefined;
});

// ─── helpers ──────────────────────────────────────────────────────────────────

async function openExtensionPopup() {
  if (browser.action?.openPopup) {
    return browser.action.openPopup();
  }

  if (browser.browserAction?.openPopup) {
    return browser.browserAction.openPopup();
  }

  throw new Error("This Firefox version does not allow the extension popup to be opened from the page.");
}

async function startTextAnalysis(text) {
  textJob  = { status: "analyzing", text };
  segmentJob   = null; // clear any stale segment job
  analysisBlob = null;
  openExtensionPopup().catch(() => {});

  try {
    const result = await analyzeText(text);
    textJob = { status: "done", text, result };
  } catch (err) {
    textJob = { status: "error", text, error: err.message || "Analysis failed." };
  }
}

async function analyzeText(text) {
  const response = await fetch(`${VERITAS_BASE_URL}/api/analyze-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || "Analysis failed.");
  if (!body) throw new Error("Invalid response from analysis server.");
  return body;
}

async function analyzeSegment(payload) {
  const blob = new Blob([payload.buffer], { type: payload.type || "video/webm" });
  const formData = new FormData();
  formData.append("video", blob, payload.name || "segment.webm");

  const response = await fetch(`${VERITAS_BASE_URL}/api/analyze-unverified`, {
    method: "POST",
    body: formData,
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(body?.error || "Analysis failed.");
  }
  if (!body) throw new Error("Invalid response from analysis server.");
  return body; // { transcript, analysis, sources }
}

async function verifyBlob(payload) {
  if (!payload?.buffer) {
    throw new Error("No video data was provided by the page.");
  }

  const blob = new Blob([payload.buffer], {
    type: payload.type || "video/mp4",
  });
  const formData = new FormData();
  formData.append("video", blob, payload.name || "selected-video.mp4");

  const response = await fetch(`${VERITAS_BASE_URL}/api/verify-video`, {
    method: "POST",
    body: formData,
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(body?.error || "Veritas could not verify this video.");
  }
  if (!body) throw new Error("Invalid response from Veritas server.");

  return body.result;
}
