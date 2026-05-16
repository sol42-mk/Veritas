const VERITAS_BASE_URL = "http://localhost:3000";

let popupIntent = null;

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

  return undefined;
});

async function openExtensionPopup() {
  if (browser.action?.openPopup) {
    return browser.action.openPopup();
  }

  if (browser.browserAction?.openPopup) {
    return browser.browserAction.openPopup();
  }

  throw new Error("This Firefox version does not allow the extension popup to be opened from the page.");
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

  return body.result;
}
