const VERITAS_BASE_URL = "http://localhost:3000";

const verifyButton   = document.getElementById("verify-button");
const openPageButton = document.getElementById("open-page-button");
const statusPanel    = document.getElementById("status");
const resultPanel    = document.getElementById("result");
const contextPanel   = document.getElementById("video-context");
const loadingPanel   = document.getElementById("loading");

let activeTab        = null;
let selectedInfo     = null;
let pollInterval     = null;
let textPollInterval = null;

init();

async function init() {
  activeTab = await getActiveTab();

  // Text analysis job takes first priority
  const textJob = await browser.runtime.sendMessage({ type: "VERITAS_GET_TEXT_JOB" }).catch(() => null);
  if (textJob) {
    showTextMode(textJob.text);
    applyTextJobState(textJob);
    if (textJob.status === "analyzing") startTextPolling();
    return;
  }

  // Check for an in-progress segment job
  const job = await browser.runtime.sendMessage({ type: "VERITAS_GET_SEGMENT_JOB" }).catch(() => null);
  if (job) {
    showSegmentMode();
    applyJobState(job);
    if (job.status !== "done" && job.status !== "error") startPolling();
    return;
  }

  // Normal flow
  selectedInfo = await getSelectedVideoInfo();
  renderContext();

  verifyButton.addEventListener("click", verifySelectedVideo);
  openPageButton.addEventListener("click", openFullVerifier);

  const intent = await getPopupIntent();
  if (shouldAutoVerify(intent)) {
    await verifySelectedVideo();
  }
}

// ─── segment job mode ────────────────────────────────────────────────────────

function showSegmentMode() {
  verifyButton.style.display   = "none";
  openPageButton.style.display = "none";
  contextPanel.style.display   = "none";
  document.querySelector("header").querySelector("h1").textContent = "Segment check";
}

function applyJobState(job) {
  if (!job) return;

  if (job.status === "done") {
    stopPolling();
    loadingPanel.style.display = "none";
    renderResult(job.result, { hasAnalysisBlob: Boolean(job.hasAnalysisBlob) });
    return;
  }

  if (job.status === "error") {
    stopPolling();
    loadingPanel.style.display = "none";
    renderFailure(job.error || "Verification failed.");
    return;
  }

  // recording or verifying — show spinner
  loadingPanel.classList.remove("hidden");
  statusPanel.className = "panel hidden";
  resultPanel.className = "panel hidden";

  const label = job.status === "verifying" ? "Verifying with Veritas…" : (job.progress || "Recording…");
  loadingPanel.querySelector(".loading-label").textContent = label;
}

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  let ticks = 0;
  pollInterval = setInterval(async () => {
    if (++ticks > 300) { // 2-minute safety cap
      stopPolling();
      renderFailure("Verification timed out. Please try again.");
      return;
    }
    const job = await browser.runtime.sendMessage({ type: "VERITAS_GET_SEGMENT_JOB" }).catch(() => null);
    applyJobState(job);
  }, 400);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ─── text analysis mode ──────────────────────────────────────────────────────

function showTextMode(text) {
  verifyButton.style.display   = "none";
  openPageButton.style.display = "none";
  document.querySelector("header").querySelector("h1").textContent = "Text fact-check";

  if (text) {
    const snippet = text.length > 140 ? text.slice(0, 140) + "…" : text;
    contextPanel.style.display = "block";
    contextPanel.className = "panel muted";
    contextPanel.style.fontStyle = "italic";
    contextPanel.textContent = snippet;
  } else {
    contextPanel.style.display = "none";
  }
}

function applyTextJobState(job) {
  if (!job) return;

  if (job.status === "done") {
    stopTextPolling();
    loadingPanel.style.display = "none";
    renderTextResult(job.result);
    return;
  }

  if (job.status === "error") {
    stopTextPolling();
    loadingPanel.style.display = "none";
    renderFailure(job.error || "Analysis failed.");
    return;
  }

  // analyzing — show spinner
  loadingPanel.classList.remove("hidden");
  statusPanel.className = "panel hidden";
  resultPanel.className = "panel hidden";
  loadingPanel.querySelector(".loading-label").textContent = "Searching the web…";
}

function startTextPolling() {
  if (textPollInterval) clearInterval(textPollInterval);
  let ticks = 0;
  textPollInterval = setInterval(async () => {
    if (++ticks > 150) { // 1-minute safety cap
      stopTextPolling();
      renderFailure("Analysis timed out. Please try again.");
      return;
    }
    const job = await browser.runtime.sendMessage({ type: "VERITAS_GET_TEXT_JOB" }).catch(() => null);
    applyTextJobState(job);
  }, 400);
}

function stopTextPolling() {
  if (textPollInterval) {
    clearInterval(textPollInterval);
    textPollInterval = null;
  }
}

function renderTextResult(result) {
  if (!result) {
    renderFailure("Analysis returned no result.");
    return;
  }

  statusPanel.className = "panel success";
  statusPanel.innerHTML = "<strong>Web context found ✓</strong>";

  const sourcesHtml = result.sources?.length
    ? `<div class="analysis-sources">
         <p class="analysis-sources-label">Sources</p>
         ${result.sources.map((s) => `<button class="source-link" data-href="${escapeHtml(s.url)}">${escapeHtml(s.title)}</button>`).join("")}
       </div>`
    : "";

  resultPanel.className = "panel";
  resultPanel.innerHTML = `
    <div class="analysis-result">
      <p class="analysis-label">Fact-check</p>
      <p class="analysis-text">${escapeHtml(result.analysis)}</p>
      ${sourcesHtml}
    </div>
  `;

  resultPanel.querySelectorAll(".source-link").forEach((btn) => {
    btn.addEventListener("click", () => browser.tabs.create({ url: btn.dataset.href }));
  });
}

// ─── normal video flow ────────────────────────────────────────────────────────

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
    return await browser.runtime.sendMessage({ type: "VERITAS_GET_POPUP_INTENT" });
  } catch {
    return null;
  }
}

function shouldAutoVerify(intent) {
  if (!intent?.autoVerify || !activeTab?.id || !selectedInfo) return false;
  if (intent.tabId !== activeTab.id) return false;
  return Date.now() - Number(intent.requestedAt || 0) < 10_000;
}

function isBlob(info) {
  return Boolean(info?.sourceUrl?.startsWith("blob:"));
}

function renderContext() {
  if (!selectedInfo) {
    contextPanel.textContent = "No playable video was found on this page.";
    verifyButton.disabled = true;
    return;
  }

  verifyButton.disabled = false;

  if (isBlob(selectedInfo)) {
    verifyButton.textContent = "Select Segment →";
    setStatus("Streaming video — click to open the segment selector.", "muted");
  }

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

  // Blob/MSE video — open segment overlay on the page and close the popup
  if (isBlob(selectedInfo)) {
    await browser.tabs.sendMessage(activeTab.id, { type: "VERITAS_SHOW_SEGMENT_OVERLAY" }).catch(() => {});
    window.close();
    return;
  }

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
  if (selectedInfo?.pageUrl)   url.searchParams.set("pageUrl",   selectedInfo.pageUrl);
  if (selectedInfo?.pageHost)  url.searchParams.set("pageHost",  selectedInfo.pageHost);
  browser.tabs.create({ url: url.toString() });
}

// ─── result rendering ────────────────────────────────────────────────────────

function renderResult(result, opts = {}) {
  if (!result) {
    renderFailure("Veritas returned an empty result.");
    return;
  }

  const verified = result.status === "verified";
  const warning  = result.status === "fingerprint-mismatch" || result.status === "low-confidence";

  // Status badge
  if (verified) {
    statusPanel.className = "panel success";
    statusPanel.innerHTML = "<strong>This is a registered Veritas video ✓</strong>";
  } else {
    statusPanel.className = "panel error";
    statusPanel.innerHTML = "<strong>This video could not be verified by Veritas</strong>";
  }

  // Source name (always shown when available)
  const sourceName = result.record?.sourceName
    ? `<p class="source-name">${escapeHtml(result.record.sourceName)}</p>`
    : "";

  // Action buttons
  const verifyUrl  = result.record?.watermarkId
    ? `http://localhost:3000/verify?watermarkId=${encodeURIComponent(result.record.watermarkId)}`
    : null;
  const originalUrl = result.contextRecord?.claim?.referenceUrl || null;

  const actions = [
    verifyUrl   ? `<button class="action-btn" data-href="${escapeHtml(verifyUrl)}">View in explorer →</button>` : "",
    originalUrl ? `<button class="action-btn" data-href="${escapeHtml(originalUrl)}">See original video →</button>` : "",
  ].filter(Boolean).join("");

  // Debug rows (hidden by default)
  const debugRows = [
    result.record?.watermarkId
      ? `<div><span class="label">Watermark ID</span><div class="mono">${escapeHtml(result.record.watermarkId)}</div></div>` : "",
    result.sourceProfile
      ? `<div><span class="label">Trust tier</span><div>${escapeHtml(result.sourceProfile.trust.tierName)}</div></div>` : "",
    result.extraction?.method
      ? `<div><span class="label">Method</span><div>${escapeHtml(result.extraction.method)}</div></div>` : "",
    result.extraction?.confidence !== undefined
      ? `<div><span class="label">Confidence</span><div>${(result.extraction.confidence * 100).toFixed(1)}%</div></div>` : "",
    result.extraction?.framesAnalyzed != null
      ? `<div><span class="label">Frames analyzed</span><div>${result.extraction.framesAnalyzed}</div></div>` : "",
    result.extraction?.candidatesTested != null
      ? `<div><span class="label">DCT candidates</span><div>${result.extraction.candidatesTested}</div></div>` : "",
    result.fingerprintCheck
      ? `<div><span class="label">Fingerprint</span><div>${escapeHtml(result.fingerprintCheck.message)}</div></div>` : "",
  ].filter(Boolean).join("");

  const voteHtml = verified && result.record?.sourceId
    ? `<div class="vote-section">
        <p class="vote-label">Was this source accurate?</p>
        <div class="vote-row">
          <button class="vote-btn" data-vote="1">👍 <span id="vote-likes">—</span></button>
          <button class="vote-btn" data-vote="-1">👎 <span id="vote-dislikes">—</span></button>
        </div>
      </div>`
    : "";

  resultPanel.className = "panel";
  resultPanel.innerHTML = `
    ${sourceName}
    ${voteHtml}
    ${actions ? `<div class="actions">${actions}</div>` : ""}
    ${!verified && opts.hasAnalysisBlob ? `<div id="analysis-section"><button class="action-btn find-info-btn" id="find-info">Find info about this video</button></div>` : ""}
    ${debugRows ? `
      <button class="debug-toggle" id="debug-toggle">See debug info ▾</button>
      <div class="kv hidden" id="debug-rows">${debugRows}</div>
    ` : ""}
  `;

  resultPanel.querySelectorAll(".action-btn[data-href]").forEach((btn) => {
    btn.addEventListener("click", () => browser.tabs.create({ url: btn.dataset.href }));
  });

  document.getElementById("find-info")?.addEventListener("click", startContextAnalysis);

  document.getElementById("debug-toggle")?.addEventListener("click", () => {
    const rows = document.getElementById("debug-rows");
    const btn  = document.getElementById("debug-toggle");
    rows.classList.toggle("hidden");
    btn.textContent = rows.classList.contains("hidden") ? "See debug info ▾" : "See debug info ▴";
  });

  if (verified && result.record?.sourceId) {
    const voteSection = resultPanel.querySelector(".vote-section");
    const sourceId = result.record.sourceId;

    voteSection?.querySelectorAll(".vote-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const data = await castVote(sourceId, Number(btn.dataset.vote));
        if (data && voteSection) updateVoteUI(voteSection, data);
      });
    });

    fetchVotes(sourceId).then((data) => {
      if (data && voteSection) updateVoteUI(voteSection, data);
    });
  }
}

async function startContextAnalysis() {
  const section = document.getElementById("analysis-section");
  if (!section) return;

  section.innerHTML = `
    <div class="analysis-loading">
      <div class="spinner"></div>
      <span>Transcribing audio and searching the web…</span>
    </div>
  `;

  try {
    const data = await browser.runtime.sendMessage({ type: "VERITAS_ANALYZE_SEGMENT" });

    const sourcesHtml = data.sources?.length
      ? `<div class="analysis-sources">
           <p class="analysis-sources-label">Sources</p>
           ${data.sources.map((s) => `
             <button class="source-link" data-href="${escapeHtml(s.url)}">${escapeHtml(s.title)}</button>
           `).join("")}
         </div>`
      : "";

    const transcriptHtml = data.transcript
      ? `<details class="analysis-transcript">
           <summary>Transcript</summary>
           <p>${escapeHtml(data.transcript)}</p>
         </details>`
      : "";

    section.innerHTML = `
      <div class="analysis-result">
        <p class="analysis-label">Web context</p>
        <p class="analysis-text">${escapeHtml(data.analysis)}</p>
        ${sourcesHtml}
        ${transcriptHtml}
      </div>
    `;

    section.querySelectorAll(".source-link").forEach((btn) => {
      btn.addEventListener("click", () => browser.tabs.create({ url: btn.dataset.href }));
    });
  } catch (err) {
    section.innerHTML = `
      <p class="result-msg">${escapeHtml(err.message || "Analysis failed.")}</p>
      <button class="action-btn" id="find-info">Try again</button>
    `;
    section.querySelector("#find-info")?.addEventListener("click", startContextAnalysis);
  }
}

function renderFailure(message) {
  statusPanel.className = "panel error";
  statusPanel.innerHTML = "<strong>Could not verify this video</strong>";

  resultPanel.className = "panel";
  const blobError = message.includes("blob") || message.includes("segment selector");
  resultPanel.innerHTML = blobError
    ? `<p class="result-msg">Hover over the video and click <em>Verify with Veritas</em> to open the segment selector.</p>`
    : `<p class="result-msg">${escapeHtml(message)}</p>`;
}

function setStatus(message, className) {
  statusPanel.className = `panel ${className || ""}`;
  statusPanel.textContent = message;
}

// ─── source credibility votes ─────────────────────────────────────────────────

async function getOrCreateVoterId() {
  const stored = await browser.storage.local.get("veritasVoterId").catch(() => ({}));
  if (stored.veritasVoterId) return stored.veritasVoterId;
  const id = crypto.randomUUID();
  await browser.storage.local.set({ veritasVoterId: id }).catch(() => {});
  return id;
}

async function fetchVotes(sourceId) {
  const voterId = await getOrCreateVoterId();
  const res = await fetch(
    `${VERITAS_BASE_URL}/api/source-votes?sourceId=${encodeURIComponent(sourceId)}&voterId=${encodeURIComponent(voterId)}`,
  ).catch(() => null);
  if (!res?.ok) return null;
  return res.json().catch(() => null);
}

async function castVote(sourceId, vote) {
  const voterId = await getOrCreateVoterId();
  const res = await fetch(`${VERITAS_BASE_URL}/api/source-votes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId, voterId, vote }),
  }).catch(() => null);
  if (!res?.ok) return null;
  return res.json().catch(() => null);
}

function updateVoteUI(section, data) {
  if (!data) return;
  section.querySelector("#vote-likes").textContent = data.likes;
  section.querySelector("#vote-dislikes").textContent = data.dislikes;
  section.querySelectorAll(".vote-btn").forEach((btn) => {
    btn.classList.toggle("vote-active", data.userVote === Number(btn.dataset.vote));
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
