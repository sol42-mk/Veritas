/** @type {import('next').NextConfig} */
const nextConfig = {
  // ffmpeg.wasm needs SharedArrayBuffer, which requires these headers
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
  webpack(config) {
    // Allow ffmpeg.wasm to load its .wasm file
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
};

module.exports = nextConfig;
