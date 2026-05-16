const verifyButton = document.getElementById("verify-button");
const openPageButton = document.getElementById("open-page-button");
const statusPanel = document.getElementById("status");
const resultPanel = document.getElementById("result");
const contextPanel = document.getElementById("video-context");

let activeTab = null;
let selectedInfo = null;

init();

async function init() {
  activeTab = await getActiveTab();
  selectedInfo = await getSelectedVideoInfo();
  renderContext();

  verifyButton.addEventListener("click", verifySelectedVideo);
  openPageButton.addEventListener("click", openFullVerifier);

  const intent = await getPopupIntent();
  if (shouldAutoVerify(intent)) {
    await verifySelectedVideo();
  }
}

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function getSelectedVideoInfo() {
  if (!activeTab?.id) return null;

  try {
    const response = await browser.tabs.sendMessage(activeTab.id, {
      type: "VERITAS_GET_SELECTED_VIDEO_INFO",
    });
    return response?.ok ? response.info : null;
  } catch {
    return null;
  }
}

async function getPopupIntent() {
  try {
    return await browser.runtime.sendMessage({
      type: "VERITAS_GET_POPUP_INTENT",
    });
  } catch {
    return null;
  }
}

function shouldAutoVerify(intent) {
  if (!intent?.autoVerify || !activeTab?.id || !selectedInfo) return false;
  if (intent.tabId !== activeTab.id) return false;

  const requestedAt = Number(intent.requestedAt || 0);
  return Date.now() - requestedAt < 10_000;
}

function renderContext() {
  if (!selectedInfo) {
    contextPanel.textContent = "No playable video was found on this page.";
    verifyButton.disabled = true;
    return;
  }

  verifyButton.disabled = false;
  contextPanel.innerHTML = `
    <div><span class="label">Page</span><div class="mono">${escapeHtml(selectedInfo.pageHost || "unknown")}</div></div>
    <div class="kv">
      <div><span class="label">Detected source</span><div class="mono">${escapeHtml(selectedInfo.sourceUrl || "not exposed")}</div></div>
      <div><span class="label">Size</span><div>${selectedInfo.width || 0} x ${selectedInfo.height || 0}</div></div>
    </div>
  `;
}

async function verifySelectedVideo() {
  if (!activeTab?.id) return;

  setStatus("Reading selected video from the page...", "muted");
  resultPanel.className = "panel hidden";
  verifyButton.disabled = true;

  try {
    const extraction = await browser.tabs.sendMessage(activeTab.id, {
      type: "VERITAS_EXTRACT_SELECTED_VIDEO",
    });

    if (!extraction?.ok) {
      throw new Error(extraction?.error || "Could not read the selected video.");
    }

    setStatus("Uploading video to local Veritas verifier...", "muted");
    const result = await browser.runtime.sendMessage({
      type: "VERITAS_VERIFY_BLOB",
      payload: extraction.payload,
    });

    renderResult(result);
  } catch (error) {
    renderFailure(error.message || "Could not verify this video.");
  } finally {
    verifyButton.disabled = false;
  }
}

function openFullVerifier() {
  const url = new URL("http://localhost:3000/verify");
  if (selectedInfo?.sourceUrl) url.searchParams.set("sourceUrl", selectedInfo.sourceUrl);
  if (selectedInfo?.pageUrl) url.searchParams.set("pageUrl", selectedInfo.pageUrl);
  if (selectedInfo?.pageHost) url.searchParams.set("pageHost", selectedInfo.pageHost);
  browser.tabs.create({ url: url.toString() });
}

function renderResult(result) {
  if (!result) {
    renderFailure("Veritas returned an empty result.");
    return;
  }

  const isVerified = result.status === "verified";
  const isWarning = result.status === "fingerprint-mismatch" || result.status === "low-confidence";
  statusPanel.className = `panel ${isVerified ? "success" : isWarning ? "warning" : "error"}`;
  statusPanel.textContent = result.message || result.status;

  resultPanel.className = "panel";
  resultPanel.innerHTML = `
    <div class="kv">
      <div><span class="label">Status</span><div>${escapeHtml(result.status)}</div></div>
      ${result.record ? `<div><span class="label">Source</span><div>${escapeHtml(result.record.sourceName)}</div></div>` : ""}
      ${result.sourceProfile ? `<div><span class="label">Trust tier</span><div>${escapeHtml(result.sourceProfile.trust.tierName)}</div></div>` : ""}
      ${result.extraction ? `<div><span class="label">Method</span><div>${escapeHtml(result.extraction.method)}</div></div>` : ""}
      ${result.extraction?.confidence !== undefined ? `<div><span class="label">Confidence</span><div>${(result.extraction.confidence * 100).toFixed(1)}%</div></div>` : ""}
      ${result.record ? `<div><span class="label">Watermark ID</span><div class="mono">${escapeHtml(result.record.watermarkId)}</div></div>` : ""}
      ${result.fingerprintCheck ? `<div><span class="label">Fingerprint</span><div>${escapeHtml(result.fingerprintCheck.message)}</div></div>` : ""}
    </div>
  `;
}

function renderFailure(message) {
  statusPanel.className = "panel error";
  statusPanel.textContent = message;
  resultPanel.className = "panel warning";
  resultPanel.innerHTML = `
    <strong>Fallback</strong>
    <p>
      This site may expose the video as a MediaSource blob or segmented stream. Download the video locally if possible,
      then open the full Veritas verifier and upload the file.
    </p>
  `;
}

function setStatus(message, className) {
  statusPanel.className = `panel ${className || ""}`;
  statusPanel.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
