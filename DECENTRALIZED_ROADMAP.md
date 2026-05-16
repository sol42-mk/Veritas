# Veritas Decentralized Roadmap

This branch moves Veritas away from a C2PA-style certificate model and toward a decentralized provenance model.

The product goal is:

> Anyone can register media, but the app clearly separates self-registered provenance from verified-source provenance.

## Step 1: Source Trust Tiers

Current status: started.

Veritas now models sources with three trust tiers:

- Tier 1 - Verified Newsroom: a wallet hardcoded by the Veritas team and associated with a known organization.
- Tier 2 - Registered Independent: any wallet that registers a video without Veritas team verification.
- Tier 3 - Chain of Custody: a record that started from a Tier 2 source and was later cited or shared by a Tier 1 source.

The current deployed Solana record does not store the trust tier directly yet. For the MVP, the app derives the tier from the registering wallet:

- Hardcoded known wallets become Tier 1.
- Unknown wallets become Tier 2.
- Tier 3 needs a v2 record type because it links two source events.

## Step 2: Perceptual VideoHash

Current status: started.

The current on-chain record stores a SHA-256 hash of the original uploaded file. SHA-256 is exact, so it changes completely if the video is re-encoded, resized, or recompressed.

The current branch adds an optional VideoHash backend worker. If installed, new records store the perceptual fingerprint in the existing Solana `video_hash` field as:

```text
videohash:<16 hex chars>
```

If the worker is unavailable, the app falls back to the legacy SHA-256 value so registration still works.

The expected flow is:

1. Register page uploads the video to the backend.
2. Backend computes the normal SHA-256 hash.
3. Backend also computes a VideoHash perceptual fingerprint.
4. Solana registration stores the VideoHash value in the current record field for now.
5. Verify page computes VideoHash for the uploaded video.
6. Verification compares the uploaded VideoHash against the registered VideoHash with a Hamming-distance threshold.

This reduces the risk where someone copies a valid watermark ID into unrelated footage. A copied watermark ID should only verify if the perceptual fingerprint also matches the registered video closely enough.

A future v2 record should store SHA-256 and VideoHash as separate named fields instead of overloading the old `video_hash` field.

## Step 3: Context-Linked Registration

Current status: started.

The current record proves that a file was registered by a wallet at a time. It does not store what the uploader claims the video shows.

The current branch adds optional context fields:

- Claimed location
- Claimed event date
- People or organizations involved
- Short description
- External reference URL

Users can flag records when the claimed context appears wrong. These flags do not delete the original registration; they are separate dispute events.

Uploaders can open `/my-videos`, connect the same wallet used for registration, and update the original/public video URL after the record has already been created.

Each saved or updated context package is hashed and anchored to Solana through the Memo program. Supabase remains the queryable database, while Solana provides a timestamped commitment to the exact context package hash.

For the hackathon prototype, context claims and flags are stored in Supabase when configured. If Supabase is not configured, the app falls back to:

```text
.veritas-data/context-records.json
```

This keeps the app moving without requiring a Solana redeploy. The production version should move context references to IPFS/Arweave plus Solana references, or a v2 Solana account model.

Tier 3 chain-of-custody is now prototyped as a citation event: a Tier 1 verified newsroom wallet can cite an existing context record. This does not rewrite the original registration; it appends a separate citation to the context record.

## Step 4: Stronger Visual Fingerprinting

Current status: planned after VideoHash.

The current DCT watermark is useful for the hackathon demo, but it is still an embedded watermark. The longer-term direction is neural or perceptual fingerprinting:

- Use VideoHash first because it is simpler and open source.
- Evaluate SSCD-style embeddings later for stronger visual similarity matching.
- Keep watermark IDs as a direct lookup path, but do not rely on them alone for trust.

## Step 5: Browser Extension

Current status: started.

The app UI should eventually move closer to where users see videos. The Firefox extension should:

- Let a user select a video element on a web page.
- Send the video file or accessible video URL to the Veritas verifier.
- Show whether the video has a Veritas record.
- Show the source trust tier, timestamp, and context claims.
- Show a clear warning when the video cannot be verified.

The extension should reuse the same backend verification API as the website.

The current prototype lives in `extension/firefox`. It injects a "Verify with Veritas" button over page videos and opens the local verifier. Automatic upload of platform-hosted videos still needs URL-fetch handling and will not work on sites that block video access through CORS, blob URLs, or signed media URLs.

## Important Migration Note

The current Solana program stores the original MVP record shape. Adding VideoHash, context fields, flags, and chain-of-custody should be implemented as a v2 record instead of mutating the old layout in place.

That avoids breaking old hackathon registrations and makes it possible to verify both old and new records during the transition.
