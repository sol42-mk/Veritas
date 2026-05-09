/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep cross-origin isolation enabled; it is harmless for the backend
  // watermark worker and useful if browser-side media tooling is added later.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy",   value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy",  value: "require-corp" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
