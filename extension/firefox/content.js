const BUTTON_ID = "veritas-video-check-button";
let activeVideo = null;

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

async function extractVideoBlob(video) {
  const sourceUrl = video.currentSrc || video.src || "";

  if (!sourceUrl) {
    throw new Error("No video URL was exposed by this page.");
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Could not read selected video (${response.status}).`);
  }

  const blob = await response.blob();
  if (!blob.size) {
    throw new Error("Selected video returned an empty file.");
  }

  return {
    name: buildFileName(blob.type),
    type: blob.type || "video/mp4",
    buffer: await blob.arrayBuffer(),
    info: getVideoInfo(video),
  };
}

function buildFileName(mimeType) {
  const extension = mimeType.includes("webm") ? "webm" : mimeType.includes("quicktime") ? "mov" : "mp4";
  return `veritas-selected-video.${extension}`;
}

function getBestVideo() {
  if (activeVideo) return activeVideo;

  const videos = [...document.querySelectorAll("video")]
    .filter((video) => {
      const rect = video.getBoundingClientRect();
      return rect.width > 120 && rect.height > 90;
    })
    .sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    });

  return videos[0] ?? null;
}

function getButton() {
  let button = document.getElementById(BUTTON_ID);
  if (button) return button;

  button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.textContent = "Verify with Veritas";
button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    const video = getBestVideo();
    if (!video) return;

    browser.runtime.sendMessage({
      type: "VERITAS_OPEN_EXTENSION_POPUP",
      autoVerify: true,
      ...getVideoInfo(video),
    }).catch((error) => showButtonError(error.message || "Could not open Veritas popup."));
  });

  document.documentElement.appendChild(button);
  return button;
}

function showButtonError(message) {
  const button = getButton();
  button.textContent = message;
  button.style.left = "12px";
  button.style.top = `${Math.max(12, window.scrollY + 12)}px`;
  button.style.opacity = "1";
  button.style.pointerEvents = "auto";

  window.setTimeout(() => {
    button.textContent = "Verify with Veritas";
    button.style.opacity = "0";
    button.style.pointerEvents = "none";
  }, 3500);
}

function showButton(video) {
  activeVideo = video;
  const rect = video.getBoundingClientRect();
  const button = getButton();
  button.style.opacity = "1";
  button.style.pointerEvents = "auto";
  button.style.left = `${Math.max(12, window.scrollX + rect.right - 150)}px`;
  button.style.top = `${Math.max(12, window.scrollY + rect.top + 12)}px`;
}

function hideButtonSoon() {
  window.setTimeout(() => {
    const button = getButton();
    if (!button.matches(":hover")) {
      button.style.opacity = "0";
      button.style.pointerEvents = "none";
      activeVideo = null;
    }
  }, 150);
}

function installVideoListeners() {
  for (const video of document.querySelectorAll("video")) {
    if (video.dataset.veritasButtonInstalled === "1") continue;
    video.dataset.veritasButtonInstalled = "1";
    video.addEventListener("mouseenter", () => showButton(video));
    video.addEventListener("mouseleave", hideButtonSoon);
  }
}

function injectStyles() {
  if (document.getElementById("veritas-video-check-styles")) return;

  const style = document.createElement("style");
  style.id = "veritas-video-check-styles";
  style.textContent = `
    #${BUTTON_ID} {
      position: absolute;
      z-index: 2147483647;
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 6px;
      background: rgba(15, 23, 42, 0.94);
      color: white;
      cursor: pointer;
      font: 600 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 8px 10px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 120ms ease;
    }
  `;
  document.documentElement.appendChild(style);
}

browser.runtime.onMessage.addListener((message) => {
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
    if (!video) {
      return Promise.resolve({ ok: false, error: "No playable video was found on this page." });
    }

    return extractVideoBlob(video)
      .then((payload) => ({ ok: true, payload }))
      .catch((error) => ({ ok: false, error: error.message, info: getVideoInfo(video) }));
  }

  return undefined;
});

injectStyles();
installVideoListeners();

const observer = new MutationObserver(() => installVideoListeners());
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});
