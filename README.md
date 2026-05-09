# Veritas

Hackathon MVP for verifying the provenance of news videos.

Veritas lets a journalist upload a video, have the backend compute a SHA-256 hash, embed a hidden `veritas_id` in the file metadata and video frames, and register the proof on Solana devnet. A viewer can later use the watermark ID to check whether the video maps to an on-chain record.

The stable MVP uses MP4 metadata. The `robust-watermarking` branch also adds an experimental backend DCT spread-spectrum visual watermark that is embedded into video frames. This should be tested against real platform re-encoding before it is treated as production-grade.

## Current Environment

This checkout is already in Ubuntu/WSL:

```bash
/home/shenol/projects/veritas
```

Open VS Code from Ubuntu/WSL:

```bash
cd ~/projects/veritas
code .
```

The Solana CLI is configured for devnet:

```bash
solana config set --url devnet
solana config get
```

Expected config:

```text
RPC URL: https://api.devnet.solana.com
Keypair Path: /home/shenol/.config/solana/id.json
Commitment: confirmed
```

## Wallet Model

There are two separate wallets:

- Phantom wallet: used in the browser by the app to sign and pay register transactions.
- Solana CLI wallet: used from the terminal for deploying the Anchor program.

Keep these separate for the hackathon. Do not import your Phantom seed phrase into the Solana CLI.

Set Phantom to devnet in the browser extension settings. The CLI is already on devnet.

If the CLI keypair does not exist yet, create and fund it:

```bash
solana-keygen new
solana address
solana airdrop 2
solana balance
```

## Start Working

From Ubuntu/WSL:

```bash
cd ~/projects/veritas
npm install
cp .env.example .env.local
npm run dev
```

Open:

```text
http://localhost:3000/register
```

Make sure Phantom is installed in the Windows browser, connected to devnet, and funded with devnet SOL.

## Source Registry

Uploaders do not choose their own source in the UI. The app derives the source profile from the connected Phantom wallet.

For the hackathon, wallet-to-source assignments live in:

```text
lib/sourceRegistry.ts
```

Unknown wallets currently default to:

```text
source_id: independent
source_name: Independent Journalist
```

When you know a journalist or newsroom wallet address, add it to `SOURCE_PROFILES_BY_WALLET`. Supabase is a good next step if these assignments need to be edited from an admin UI instead of code.

## Solana Program

The frontend and Anchor program currently use the generated Anchor program ID:

```text
4qBS9B7cZ5r4CeNMaRvxELmZugRroXUwRg8Ss4MP3CVi
```

Build and deploy from Ubuntu/WSL:

```bash
anchor build
anchor deploy --provider.cluster devnet
```

If you regenerate the program keypair or deploy under a different program ID, update:

- `Anchor.toml`
- `lib/solana.ts`
- `lib/veritas.ts`
- `programs/veritas/src/lib.rs`

Then rebuild and restart the app.

## Project Structure

```text
app/page.tsx               Home page
app/register/page.tsx      Journalist upload and register UI
app/verify/page.tsx        Watermark extraction and Solana record lookup UI
app/layout.tsx             App shell and navigation
lib/solana.ts              Phantom transaction helpers and PDA lookup
lib/sourceRegistry.ts      Wallet-to-source assignment registry
lib/serverDctWatermark.ts  Backend ffmpeg and DCT spread-spectrum video worker
lib/watermarkJobs.ts       In-memory backend watermark job progress tracker
lib/veritas.ts             Frontend API helpers and record decoding helpers
programs/veritas/src/lib.rs Anchor smart contract
Anchor.toml                Anchor workspace config
.env.example               Optional environment variables
```

## Current Status

Verified locally:

- `npm run build` passes.
- `anchor build` passes after the first Cargo dependency download.
- `npm run dev` starts at `http://localhost:3000`.
- The Solana CLI is configured for devnet.
- The Solana CLI deploy wallet is `D4yxMnpxmvHgrPnQtGJWx3eCuLaVQ2z5CkufMnKaxi64`.
- The configured program ID is deployed on devnet.
- The Rust program uses `anchor-lang = "1.0.2"` to match `anchor-cli 1.0.2`.

Done:

- English home and register UI
- Home page at `/`
- Verification page at `/verify`
- Register page UI
- Phantom wallet connection
- Wallet-derived source assignment for registration
- Backend SHA-256 hashing of uploaded videos
- Metadata-based watermarking through the backend ffmpeg worker
- Experimental DCT spread-spectrum frame watermarking on the `robust-watermarking` branch
- Verification tries MP4 metadata first, then falls back to DCT visual watermark extraction
- Registration starts a backend watermark job and polls `/api/watermark/jobs` for live phase, elapsed time, and frame progress
- Watermark IDs are stored as 32-character UUID hex strings so they fit Solana PDA seed limits
- Browser-side ffmpeg has been removed; registration and verification use Next.js API routes
- Backend watermarking transcodes to a compatible MP4 instead of stream-copying unsupported codecs into MP4
- Watermarking errors include recent ffmpeg logs for debugging
- Client-side transaction construction and signing helpers
- Register flow checks that the configured Solana program exists on devnet before opening Phantom
- Real Anchor instruction discriminator wired into the frontend register transaction
- Anchor program source
- Minimal Anchor/Rust workspace config
- Verification extracts `veritas_id` from video metadata and fetches the matching Solana record
- Verification validates account ownership, discriminator, and record bounds before decoding

Backend DCT test on a real 32-second news clip:

- Exact downloaded watermarked MP4: verified through MP4 metadata, so DCT was not needed.
- Metadata stripped, no other changes: exact DCT match at 100% confidence.
- Metadata stripped and re-encoded with `libx264`, `preset medium`, `crf 28`, AAC 128k: exact DCT match at 100% confidence.
- Metadata stripped, resized to 720px wide, re-encoded with `libx264`, `preset medium`, `crf 32`, AAC 96k: exact DCT match at about 95% confidence.
- Aggressive social-style compression from about 5 MB to 0.4 MB using 480px wide, 24 FPS, `preset veryfast`, `crf 36`, AAC 64k: DCT did not identify the video.

This is good enough for the hackathon demo: Veritas survives metadata stripping, normal re-encoding, and meaningful compression/resizing, but extreme platform-style degradation can destroy the visual watermark.

Next:

- Keep collecting real clips and platform-download samples to tune DCT thresholds.
- Add clearer UI language when DCT confidence is low or the recovered ID has no on-chain match.
- Add AI/web fallback for videos that cannot be verified.

## Demo Script

Prepare two videos:

- `kanal5_demo.mp4`: registered through the app as Kanal 5.
- `unknown_demo.mp4`: not registered.

During the demo:

1. Open `/register`.
2. Connect Phantom on devnet.
3. Upload `kanal5_demo.mp4`.
4. Register it and show the Solana Explorer link.
5. Download the watermarked video.
6. Open `/verify`.
7. Upload the watermarked video and show the Solana record.
8. Verify the unknown video to show the trust contrast.

## README Rule

Keep this README current after meaningful project changes, especially changes to setup, commands, deployed program IDs, routes, or demo flow.

## Debug Notes

Browser console source map warnings from React DevTools, such as `installHook.js.map` or `react_devtools_backend_compact.js.map`, are not Veritas app failures.

If watermarking fails, check the app error text first. It should include the last ffmpeg log lines. For the smoothest demo, use a short MP4 file from a common H.264/AAC source.

The register page uses an in-memory watermark job store for progress updates. This is good for local demo and hackathon deployment on a single Node process. A production deployment should move job state and output files to durable storage such as Supabase, Redis, or object storage.

The registered hash is the SHA-256 of the original pre-watermark upload. The downloaded watermarked file has different bytes, so `/verify` displays both hashes when a file is uploaded but treats the watermark-to-record match as the current MVP verification signal.

The DCT spread-spectrum watermark is experimental. Registration sends the video to the backend worker, which uses packaged ffmpeg/ffprobe binaries, embeds the same `veritas_id` into mid-frequency DCT coefficients across frames, then writes the metadata watermark on top. If DCT embedding fails, registration falls back to metadata-only output. Verification reports whether it detected metadata or the DCT visual watermark, including a confidence score for DCT extraction.

If `/verify` reports `MP4 metadata watermark`, the DCT detector was not needed and no confidence score is shown. To see DCT confidence, test with a copy where metadata has been stripped.

The current backend DCT settings use 640px-wide processing, 6 FPS sampling, 12 repetitions per bit, and DCT coefficient delta 120. If artifacts become visible or confidence is low, tune these values in `lib/serverDctWatermark.ts`.
