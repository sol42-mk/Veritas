# Veritas

Hackathon MVP for verifying the provenance of news videos.

Veritas lets a journalist upload a video, have the backend compute a SHA-256 hash, embed a hidden `veritas_id` in the file metadata and video frames, and register the proof on Solana devnet. A viewer can later use the watermark ID to check whether the video maps to an on-chain record.

The stable MVP uses MP4 metadata. The `robust-watermarking` branch also adds an experimental backend DCT spread-spectrum visual watermark that is embedded into video frames. This should be tested against real platform re-encoding before it is treated as production-grade.

On the `shenol-work` branch, new registrations can store a VideoHash perceptual fingerprint in the existing Solana `video_hash` field as `videohash:<16 hex chars>`. If the optional VideoHash worker is not installed, the app falls back to the legacy SHA-256 value.

This branch also adds context-linked registration. Uploaders can attach claimed location, event date, subject, description, and reference URL. These context records and user flags are stored in Supabase when configured, with `.veritas-data/context-records.json` as a local fallback.

Registered uploaders can open `/my-videos`, connect the same wallet, see records saved for that wallet, and add or update the original/public video URL after registration.

For a less technical explanation of what the project does and why it exists, read [PROJECT_DETAILS.md](PROJECT_DETAILS.md).

For the decentralization plan, trust tiers, VideoHash direction, context-linked registration, and browser extension roadmap, read [DECENTRALIZED_ROADMAP.md](DECENTRALIZED_ROADMAP.md).

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

## Supabase Context Store

Context claims and flags use Supabase when these environment variables are set:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Create the required tables by opening the Supabase SQL editor and running:

```text
supabase/schema.sql
```

If the Supabase variables are not set, the app falls back to local `.veritas-data/context-records.json` storage.

Off-chain database writes require Phantom message signatures:

- Saving context after registration signs a `save-context` message.
- Updating a saved context record signs an `update-context` message.
- Adding a chain-of-custody citation signs a `cite-context` message.

These signatures prove the request came from the relevant wallet without requiring Supabase Auth.

Context packages are also anchored on Solana with the Memo program. The app hashes the context package and sends a memo transaction:

```text
veritas_context:<watermark_id>:<context_hash>
```

Supabase stores the context data, the context hash, and the memo transaction signature. Solana provides the tamper-evident timestamped commitment.

## Source Registry

Uploaders do not choose their own source in the UI. The app derives the source profile from the connected Phantom wallet.

For the hackathon, wallet-to-source assignments live in:

```text
lib/sourceRegistry.ts
```

Known newsroom wallets can be hardcoded as Tier 1 verified newsrooms. Unknown wallets currently default to Tier 2 registered independent sources:

```text
source_id: independent
source_name: Registered Independent
```

When you know a journalist or newsroom wallet address, add it to `SOURCE_PROFILES_BY_WALLET`. Supabase is a good next step if these assignments need to be edited from an admin UI instead of code.

Trust tiers currently mean:

- Tier 1 - Verified Newsroom: hardcoded wallet verified by the Veritas team.
- Tier 2 - Registered Independent: any wallet can register, but it is shown as not team-verified.
- Tier 3 - Chain of Custody: planned v2 flow for videos registered by independents and later cited by a verified newsroom.

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

List all Veritas video records currently stored by the devnet program:

```bash
npm run records
```

For machine-readable output:

```bash
npm run records -- --json
```

The existing on-chain field is still named `video_hash`. New records may contain either:

```text
videohash:<16 hex chars>
```

or the legacy 64-character SHA-256 value.

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
app/my-videos/page.tsx     Wallet-scoped registered video list and URL editor
app/mock-social/page.tsx   Demo social feed with three video post scenarios
app/api/context-records/   Context claim, flag, and citation API
app/layout.tsx             App shell and navigation
extension/firefox/         Firefox extension prototype
lib/solana.ts              Phantom transaction helpers and PDA lookup
lib/contextStore.ts        Supabase context claim and flag store with local fallback
lib/contextTypes.ts        Shared context claim and flag types
lib/walletAuth.ts          Shared wallet authorization message builder
lib/walletAuthServer.ts    Server-side Phantom message signature verification
lib/sourceRegistry.ts      Wallet-to-source assignment registry
lib/contentFingerprint.ts  Content fingerprint parsing and VideoHash comparison helpers
lib/serverDctWatermark.ts  Backend ffmpeg and DCT spread-spectrum video worker
lib/serverVideoHash.ts     Optional backend VideoHash worker bridge
lib/watermarkJobs.ts       In-memory backend watermark job progress tracker
lib/veritas.ts             Frontend API helpers and record decoding helpers
scripts/list-veritas-records.js Utility for listing devnet VideoRecord accounts
workers/cuda-dct/          Optional CuPy/CUDA DCT worker for local GPU acceleration
workers/videohash/         Optional Python VideoHash perceptual fingerprint worker
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
- Mock social demo page at `/mock-social`
- Register page UI
- Phantom wallet connection
- Wallet-derived source assignment for registration
- Source trust tiers in the register and verify UI
- Backend SHA-256 hashing of uploaded videos
- Optional VideoHash perceptual fingerprinting for new registrations
- Optional context claims saved after registration
- Wallet-scoped "My Videos" page for updating the original/public URL after registration
- Viewer flags for context mismatches
- Chain-of-custody citation prototype for Tier 1 wallets citing registered records
- Phantom message signatures for off-chain database writes
- Solana Memo anchoring for context package hashes
- Firefox extension popup that tries to verify the selected page video directly
- Video overlay "Verify with Veritas" button opens the extension popup instead of the full verify page
- Mock social feed with verified original, unverified post, and captioned excerpt scenarios
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

Backend CUDA DCT test on this WSL machine:

- GPU: NVIDIA GeForce RTX 3050 Laptop GPU.
- System ffmpeg at `/usr/bin/ffmpeg` supports `h264_nvenc`.
- CUDA/CuPy venv uses `cupy-cuda12x`, `nvidia-cuda-nvrtc-cu12`, `nvidia-cuda-runtime-cu12`, and `nvidia-cublas-cu12`.
- App endpoint completed CUDA DCT + NVENC watermarking.
- Metadata-stripped CUDA output recovered the exact DCT ID at about 99.5% confidence.

Backend DCT test on a real 32-second news clip:

- Exact downloaded watermarked MP4: verified through MP4 metadata, so DCT was not needed.
- Metadata stripped, no other changes: exact DCT match at 100% confidence.
- Metadata stripped and re-encoded with `libx264`, `preset medium`, `crf 28`, AAC 128k: exact DCT match at 100% confidence.
- Metadata stripped, resized to 720px wide, re-encoded with `libx264`, `preset medium`, `crf 32`, AAC 96k: exact DCT match at about 95% confidence.
- Aggressive social-style compression from about 5 MB to 0.4 MB using 480px wide, 24 FPS, `preset veryfast`, `crf 36`, AAC 64k: DCT did not identify the video.

This is good enough for the hackathon demo: Veritas survives metadata stripping, normal re-encoding, and meaningful compression/resizing, but extreme platform-style degradation can destroy the visual watermark.

CUDA verification test on `videos/video6_26s.mp4`:

- Source clip: 640x360, 24 FPS, 25.6 seconds, 6.4 MB. The `videos/` folder is gitignored for local test media.
- Test watermark ID: `1234567890abcdef1234567890abcdef`.
- Exact watermarked MP4: metadata contained the expected `veritas_id`.
- Metadata stripped with stream copy: exact DCT match at about 98.6% confidence over 48 sampled frames.
- Metadata stripped and re-encoded with `libx264`, `preset medium`, `crf 28`, AAC 128k: exact DCT match at about 89.8% confidence over 48 sampled frames.
- Metadata stripped, resized to 480px wide, re-encoded with `libx264`, `preset medium`, `crf 32`, AAC 96k: DCT recovered the wrong ID at about 10.2% confidence. Nearby CUDA extraction widths and block offsets did not recover this sample, so the confidence threshold treats it as inconclusive.
- Metadata stripped, resized to 360px wide, re-encoded with `libx264`, `preset veryfast`, `crf 36`, AAC 64k: DCT recovered the wrong ID at about 6.5% confidence.

Next:

- Keep collecting real clips and platform-download samples to tune DCT thresholds.
- Add a confidence threshold so low-confidence DCT recoveries are treated as inconclusive before Solana lookup.
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

The current backend DCT settings use 640px-wide processing, source FPS capped at 30 FPS, 20 repetitions per bit, DCT coefficient delta 48, and a capped zero-mean luminance adjustment per 8x8 block. CPU verification samples up to 12 frames. Optional CUDA verification samples up to 48 frames by default, because the GPU worker can afford a stronger extraction pass. If artifacts are visible or confidence is low, tune these values in `lib/serverDctWatermark.ts`.

Backend encoding and DCT embedding are CPU-safe by default. For local NVIDIA testing, put machine-specific overrides in `.env.local`, which is gitignored:

```bash
VERITAS_DCT_BACKEND=cuda
VERITAS_DCT_FALLBACK=cpu
VERITAS_CUDA_PYTHON=/home/shenol/projects/veritas/.venv-cuda/bin/python
VERITAS_CUDA_DCT_WORKER=/home/shenol/projects/veritas/workers/cuda-dct/veritas_cuda_dct.py
VERITAS_FFMPEG_PATH=/usr/bin/ffmpeg
VERITAS_FFPROBE_PATH=/usr/bin/ffprobe
VERITAS_VIDEO_ENCODER=nvenc
VERITAS_NVENC_PRESET=p4
VERITAS_NVENC_CQ=23
VERITAS_CUDA_DETECTION_FRAMES=48
VERITAS_DCT_CONFIDENCE_THRESHOLD=0.35
# Optional advanced tuning:
# VERITAS_CUDA_EXTRACTION_WIDTHS=640,632,648
# VERITAS_CUDA_EXTRACTION_OFFSETS=0:0,2:0,-2:0,0:2,0:-2
```

`VERITAS_DCT_BACKEND=cuda` uses the optional CuPy worker in `workers/cuda-dct/` for registration DCT embedding and verification DCT extraction. For registration, CUDA handles the DCT, coefficient modification, inverse DCT, and luminance adjustment. For verification, CUDA handles the DCT vote extraction and can sample more frames than the CPU verifier. CUDA verification tries nearby extraction widths and small block offsets, then keeps the highest-confidence candidate. Candidates below `VERITAS_DCT_CONFIDENCE_THRESHOLD` are treated as inconclusive and are not used for Solana lookup. `VERITAS_VIDEO_ENCODER=nvenc` separately accelerates FFmpeg encoding when your local ffmpeg supports `h264_nvenc`. If CUDA fails and `VERITAS_DCT_FALLBACK=cpu`, Veritas falls back to the TypeScript CPU DCT implementation.

The tested local CUDA venv was fixed with:

```bash
source .venv-cuda/bin/activate
python -m pip install numpy cupy-cuda12x nvidia-cuda-nvrtc-cu12 nvidia-cuda-runtime-cu12 nvidia-cublas-cu12
```

Use `workers/cuda-dct/README.md` for the CUDA worker setup details.
