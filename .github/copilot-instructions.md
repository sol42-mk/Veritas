# Veritas – AI Coding Instructions

## Project Overview

Hackathon MVP for verifying news video provenance. A journalist uploads a video → the backend embeds a `veritas_id` watermark → the proof is registered on **Solana devnet** via an Anchor program. Viewers can later verify a video's authenticity using the watermark ID.

## Architecture

```
Next.js App (app/)
  ├── /register       – upload, watermark, Phantom-sign, and register a video
  ├── /verify         – extract watermark + query on-chain record
  └── /api/
        ├── watermark/              – POST: synchronous embed (legacy; returns raw video bytes)
        ├── watermark/jobs/         – POST: create async job, GET: list jobs
        ├── watermark/jobs/[jobId]/ – GET: poll job status
        ├── watermark/jobs/[jobId]/download/ – GET: download watermarked video
        └── extract-watermark/      – POST: extract watermark from an uploaded video

lib/
  ├── serverDctWatermark.ts  – core watermark logic (CPU DCT + optional CUDA worker)
  ├── watermarkJobs.ts       – in-memory async job queue (globalThis map, 15-min TTL)
  ├── solana.ts              – Phantom wallet connect + register_video transaction builder
  ├── sourceRegistry.ts      – maps Phantom wallet pubkey → source profile
  └── veritas.ts             – shared types / utilities

programs/veritas/src/lib.rs  – Anchor smart contract (PDA per watermark_id)
workers/cuda-dct/            – optional Python/CuPy GPU worker
```

## Data Flow

1. **Embed**: `POST /api/watermark/jobs` → `watermarkJobs.ts` queues job → `serverDctWatermark.ts:embedServerWatermark()` runs ffmpeg + DCT (CPU or CUDA) → watermarked MP4 stored in job result.
2. **Register**: Browser calls `lib/solana.ts:buildRegisterTransaction()` → Phantom signs & pays → `register_video` instruction writes `VideoRecord` PDA on devnet.
3. **Verify**: `POST /api/extract-watermark` → `extractServerWatermark()` reads metadata ID + optional DCT extraction → `watermarkId` returned → client fetches PDA from chain to confirm record.

## Key Conventions

- **`export const runtime = "nodejs"` is required** on every API route that uses `serverDctWatermark.ts` (it shells out to ffmpeg/Python).
- **`export const maxDuration = 300`** is set on watermark routes because DCT processing can take minutes.
- Watermark metadata is returned in custom HTTP headers: `X-Veritas-Watermark-Id`, `X-Veritas-Original-Sha256`, `X-Veritas-Watermark-Method`, `X-Veritas-Warning`.
- The **job store** lives on `globalThis.__veritasWatermarkJobs` to survive Next.js hot-reload in dev.
- **Source profiles** (`lib/sourceRegistry.ts`) are derived from the connected Phantom wallet address — uploaders cannot self-select their source. Add known wallets to `SOURCE_PROFILES_BY_WALLET`.

## Solana / Anchor

- Program ID: `4qBS9B7cZ5r4CeNMaRvxELmZugRroXUwRg8Ss4MP3CVi` (devnet only).
- PDA seeds: `["video", watermark_id]` — lookups are O(1) by watermark ID.
- **Browser wallet (Phantom) signs and pays** — there is no server-side keypair.
- CLI wallet is separate (deploy only). Never import Phantom seed into the CLI.

## DCT Watermark (serverDctWatermark.ts)

- Default path: TypeScript CPU DCT via ffmpeg frames.
- GPU path: opt-in via `VERITAS_DCT_BACKEND=cuda`; delegates to `workers/cuda-dct/veritas_cuda_dct.py` (CuPy). Set `VERITAS_DCT_FALLBACK=cpu` to fall back automatically.
- Key constants: `BIT_REPETITIONS=20`, `DCT_STRENGTH=48`, `DCT_CONFIDENCE_THRESHOLD=0.35`.
- Extraction tries multiple widths (`[640, 632, 648]`) and pixel offsets to survive re-encoding.

## Developer Workflow

```bash
# Install and run (WSL/Ubuntu assumed; macOS paths differ)
npm install
cp .env.example .env.local   # set VERITAS_DCT_BACKEND, ffmpeg paths, etc.
npm run dev                   # http://localhost:3000

# Deploy Anchor program
anchor build
anchor deploy --provider.cluster devnet

# Solana devnet setup
solana config set --url devnet
solana airdrop 2
```

## Environment Variables (`.env.local`)

| Variable                                       | Purpose                        |
| ---------------------------------------------- | ------------------------------ |
| `VERITAS_DCT_BACKEND`                          | `cpu` (default) or `cuda`      |
| `VERITAS_DCT_FALLBACK`                         | `cpu` — fallback if CUDA fails |
| `VERITAS_CUDA_PYTHON`                          | Path to venv Python with CuPy  |
| `VERITAS_FFMPEG_PATH` / `VERITAS_FFPROBE_PATH` | Custom ffmpeg binaries         |
| `VERITAS_VIDEO_ENCODER`                        | `libx264` (default) or `nvenc` |
