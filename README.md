# Veritas

Hackathon MVP for verifying the provenance of news videos.

Veritas lets a journalist upload a video, compute a SHA-256 hash, embed a hidden `veritas_id` in MP4 metadata, and register the proof on Solana devnet. A viewer can later use the watermark ID to check whether the video maps to an on-chain record.

Current MVP limitation: the watermark is stored in MP4 metadata through `ffmpeg.wasm`. This is good enough for a demo, but many social networks strip or rewrite metadata during re-encoding. A production version needs a stronger perceptual or steganographic watermark.

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
app/verify/page.tsx        Verification placeholder
app/layout.tsx             App shell and navigation
lib/solana.ts              Phantom transaction helpers and PDA lookup
lib/sourceRegistry.ts      Wallet-to-source assignment registry
lib/veritas.ts             Hashing, watermarking, and record decoding helpers
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
- Verification placeholder at `/verify`
- Register page UI
- Phantom wallet connection
- Wallet-derived source assignment for registration
- Browser-side video hashing
- Metadata-based watermarking with `ffmpeg.wasm`
- Watermark IDs are stored as 32-character UUID hex strings so they fit Solana PDA seed limits
- ffmpeg loads its matching default browser core instead of a hardcoded older CDN core
- Watermarking now tries fast MP4 stream-copy first, then falls back to MP4 transcode for less compatible video formats
- Watermarking errors include recent ffmpeg logs for debugging
- Client-side transaction construction and signing helpers
- Register flow checks that the configured Solana program exists on devnet before opening Phantom
- Real Anchor instruction discriminator wired into the frontend register transaction
- Anchor program source
- Minimal Anchor/Rust workspace config

Next:

- Run `npm run dev` and test `/register` with Phantom on devnet.
- Build `app/verify/page.tsx`.
- Add watermark extraction for verification.
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
5. Verify the registered video versus the unknown video to show the trust contrast.

## README Rule

Keep this README current after meaningful project changes, especially changes to setup, commands, deployed program IDs, routes, or demo flow.

## Debug Notes

Browser console source map warnings from React DevTools, such as `installHook.js.map` or `react_devtools_backend_compact.js.map`, are not Veritas app failures.

If watermarking fails, check the app error text first. It should include the last ffmpeg log lines. For the smoothest demo, use a short MP4 file from a common H.264/AAC source.
