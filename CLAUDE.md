# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

Veritas is a hackathon MVP for verifying news video provenance. A journalist uploads a video → the backend embeds a `veritas_id` watermark (metadata + optional DCT spread-spectrum frames) → the proof is registered on **Solana devnet** via an Anchor smart contract. Viewers can later verify a video's authenticity using the watermark ID.

## Commands

```bash
# Dev
npm install
cp .env.example .env.local
npm run dev                          # http://localhost:3000

# Production build
npm run build && npm start

# Query on-chain records
npm run records
npm run records -- --json

# Solana / Anchor
anchor build
anchor deploy --provider.cluster devnet
solana config set --url devnet
solana airdrop 2
```

There is no test suite yet (README: "No Anchor tests yet").

## Architecture

```
Next.js App (app/)
  ├── /register        – upload, watermark, Phantom-sign, register a video
  ├── /verify          – extract watermark + query on-chain record
  ├── /my-videos       – wallet-scoped registered video list, URL editing
  ├── /mock-social     – demo social feed with three video scenarios
  └── /api/
        ├── watermark/jobs/               – async watermark jobs (POST create, GET list)
        ├── watermark/jobs/[jobId]/       – GET poll job status
        ├── watermark/jobs/[jobId]/download/ – GET download watermarked video
        ├── extract-watermark/            – POST extract watermark from uploaded video
        ├── context-records/              – save/get context claims (Supabase or local JSON)
        ├── context-records/flags/        – viewer flagging API
        └── context-records/citations/    – chain-of-custody citations

lib/
  ├── serverDctWatermark.ts  – FFmpeg + DCT watermark core (CPU default, CUDA optional)
  ├── watermarkJobs.ts       – in-memory async job queue (globalThis, 15-min TTL)
  ├── solana.ts              – Phantom connect, PDA lookup, register_video tx builder
  ├── veritas.ts             – embedWatermark(), extractWatermark(), fetchVideoRecord()
  ├── sourceRegistry.ts      – Phantom wallet pubkey → source profile mapping
  ├── contextStore.ts        – Supabase + local JSON fallback for context/flags/citations
  ├── walletAuth.ts / walletAuthServer.ts – Phantom message signing & verification
  └── contentFingerprint.ts  – VideoHash comparison, fingerprint parsing

programs/veritas/src/lib.rs  – Anchor smart contract (single register_video instruction)
workers/cuda-dct/            – optional Python/CuPy GPU DCT worker
workers/videohash/           – optional Python VideoHash perceptual fingerprint worker
```

## Data Flow

1. **Embed**: `POST /api/watermark/jobs` → `watermarkJobs.ts` queues job → `serverDctWatermark.ts:embedServerWatermark()` runs FFmpeg + DCT (CPU or CUDA) → watermarked MP4 stored in job result.
2. **Register**: Browser calls `lib/solana.ts:buildRegisterTransaction()` → Phantom signs & pays → `register_video` writes a `VideoRecord` PDA on devnet.
3. **Verify**: `POST /api/extract-watermark` → `extractServerWatermark()` reads metadata ID + optional DCT scan → `watermarkId` returned → client fetches PDA to confirm record.
4. **Context**: Phantom message signature proves wallet ownership → claim stored in Supabase (or local JSON) → context hash anchored via Solana Memo program.

## Key Conventions

- Every API route that calls `serverDctWatermark.ts` must export `runtime = "nodejs"` (it shells out to FFmpeg/Python) and `maxDuration = 300`.
- Watermark results are returned in custom headers: `X-Veritas-Watermark-Id`, `X-Veritas-Original-Sha256`, `X-Veritas-Watermark-Method`, `X-Veritas-Warning`.
- The job store lives on `globalThis.__veritasWatermarkJobs` to survive Next.js hot-reload.
- Source profiles in `sourceRegistry.ts` are derived from the connected Phantom wallet address — uploaders cannot self-select their source. Add known wallets to `SOURCE_PROFILES_BY_WALLET`.
- **Phantom (browser) signs and pays all transactions** — there is no server-side keypair. The CLI wallet is separate (deploy only); never import a Phantom seed into the CLI.

## Solana / Anchor

- Program ID: `4qBS9B7cZ5r4CeNMaRvxELmZugRroXUwRg8Ss4MP3CVi` (devnet only).
- PDA seeds: `["video", watermark_id]` — O(1) lookup by watermark ID.
- `VideoRecord` stores: `watermark_id`, `video_hash`, `source_id`, `source_name`, `timestamp`, `registered_by`. Records are immutable (no update instruction).

## DCT Watermark (`serverDctWatermark.ts`)

- Default: TypeScript CPU DCT via FFmpeg frame extraction.
- GPU path: `VERITAS_DCT_BACKEND=cuda` delegates to `workers/cuda-dct/veritas_cuda_dct.py` (CuPy). Set `VERITAS_DCT_FALLBACK=cpu` for automatic CPU fallback.
- Key constants: `BIT_REPETITIONS=20`, `DCT_STRENGTH=48`, confidence threshold `0.35`.
- Extraction tries multiple widths (`[640, 632, 648]`) and pixel offsets to survive re-encoding.
- Metadata watermark (fast, accurate) is primary; DCT visual watermark is fallback for metadata-stripped files but fails under aggressive social-media compression.

## Environment Variables (`.env.local`)

| Variable | Purpose |
|---|---|
| `VERITAS_DCT_BACKEND` | `cpu` (default) or `cuda` |
| `VERITAS_DCT_FALLBACK` | `cpu` — fallback if CUDA fails |
| `VERITAS_CUDA_PYTHON` | Path to venv Python with CuPy |
| `VERITAS_CUDA_DCT_WORKER` | Path to `workers/cuda-dct/veritas_cuda_dct.py` |
| `VERITAS_FFMPEG_PATH` / `VERITAS_FFPROBE_PATH` | Custom FFmpeg binaries |
| `VERITAS_VIDEO_ENCODER` | `libx264` (default) or `nvenc` |
| `VERITAS_VIDEOHASH_PYTHON` / `VERITAS_VIDEOHASH_WORKER` | Optional VideoHash worker |
| `ANTHROPIC_API_KEY` | Optional AI fallback features |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | Optional; falls back to `.veritas-data/context-records.json` |

## Storage Model

- **Solana devnet**: immutable video provenance records (primary).
- **Supabase** (optional): context claims, viewer flags, chain-of-custody citations.
- **Local JSON fallback**: `.veritas-data/context-records.json` when Supabase is not configured (gitignored).
- **In-memory job queue**: 15-minute TTL, single-process only — not suitable for multi-instance or production.
