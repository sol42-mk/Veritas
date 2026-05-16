# Veritas Firefox Extension

This is the browser-extension UI for Veritas.

It provides two interfaces:

- A toolbar popup that detects the largest playable video on the current page and verifies it directly.
- A small "Verify with Veritas" overlay button over videos that opens the extension popup and starts verification there.

The popup uploads the selected video to:

```text
http://localhost:3000/api/verify-video
```

## Local Testing

1. Open Firefox.
2. Go to `about:debugging#/runtime/this-firefox`.
3. Click "Load Temporary Add-on".
4. Select `extension/firefox/manifest.json`.
5. Start the Veritas site with `npm run dev`.
6. Open a page with a video.
7. Either click the Veritas extension icon in the Firefox toolbar, or hover a video and click "Verify with Veritas".
8. If you opened the toolbar popup manually, click "Verify selected video". If you used the overlay button, verification starts automatically.

## Facebook and Blocked Media

Facebook, TikTok, X, and similar platforms often expose `blob:` URLs or segmented MediaSource streams instead of a stable downloadable video file.

The extension now tries to read the selected video directly from the page. This can work for normal media URLs and simple blob-backed videos.

It may still fail for MediaSource blobs where the blob is only a playback buffer fed by many network segments. When that happens, the popup shows a fallback:

1. Download the video locally using a method you are allowed to use.
2. Upload the local file to Veritas `/verify`.
3. Veritas checks metadata, DCT watermark, and VideoHash where available.

The next production step for major social platforms is tab-capture or platform-specific segment capture, followed by perceptual matching.
