# Veritas Project Details

Veritas is a hackathon project for checking the provenance of news videos. Its purpose is to help viewers answer a focused question:

> Was this video registered by a known or trusted source through Veritas?

It is not designed to decide whether a video is true or false. Instead, it provides a way to connect a video file to a registration record that says who submitted it, when it was submitted, and which source it belongs to.

## The Problem

News videos are easy to copy, repost, compress, and detach from their original context. A viewer may see the same clip on a social platform without knowing whether it came from a real newsroom, an independent journalist, or an unknown account.

Veritas tries to reduce that uncertainty by giving trusted uploaders a way to register a video and giving viewers a way to check whether a later copy still points back to that registration.

## What Veritas Currently Does

Veritas currently has two main workflows:

1. Register a video
2. Verify a video

### Registering a Video

A journalist or uploader opens the register page, connects a Phantom wallet, and uploads a video.

The app then:

- Identifies the uploader's source from their wallet.
- Computes a fingerprint of the uploaded video.
- Creates a Veritas watermark ID for the video.
- Saves optional context claims such as location, event date, subject, description, and reference URL.
- Embeds that ID into the video metadata.
- Also embeds an experimental hidden visual watermark into the video frames.
- Lets the uploader download the watermarked video.
- Registers the video record on Solana devnet.

The source is not chosen by the uploader in the form. It is assigned from the connected wallet. Known newsroom wallets can be marked as verified by the Veritas team. Unknown wallets can still register, but they appear as registered independents rather than verified newsrooms.

### Verifying a Video

A viewer opens the verify page and uploads a video.

The app then:

- Looks for a Veritas ID inside the video metadata.
- If metadata is missing, tries to recover the hidden visual watermark from the video frames.
- Checks whether the recovered ID exists in the Veritas Solana program.
- Shows the registered source, timestamp, wallet, watermark ID, and content fingerprint if a record is found.
- Shows the source trust tier for the wallet that registered the video.
- Shows any saved context claims and existing viewer flags.

If no trusted Veritas record can be found, the app shows a clear warning:

> We couldn't verify the video as being from a trusted source.

This does not mean the video is false. It only means Veritas cannot confirm that it came from one of the trusted or registered sources known to the system.

## What Gets Stored

For each registered video, Veritas stores a record containing:

- The watermark ID
- The content fingerprint of the uploaded video
- The assigned source ID
- The assigned source name
- The registration time
- The wallet that registered it

The current project stores this record on Solana devnet.

New records can use a VideoHash perceptual fingerprint instead of only a SHA-256 file hash. This is useful because a perceptual fingerprint can still match after normal re-encoding or compression, while a SHA-256 hash only matches the exact same file bytes.

The current deployed record does not store the full trust-tier model or context claims directly yet. The app derives the current trust tier from the registered wallet. Context claims and viewer flags are stored in Supabase when configured, with a local prototype store as fallback. A future v2 record should move richer source trust and context references to Solana or decentralized storage.

## Source Trust Tiers

Veritas is moving toward a more decentralized model where registration is not limited to approved newsrooms.

The planned tiers are:

- Tier 1 - Verified Newsroom: a wallet verified by the Veritas team and associated with a known organization.
- Tier 2 - Registered Independent: any wallet can self-register. The record is timestamped, but the source is shown as not team-verified.
- Tier 3 - Chain of Custody: a video first registered by an independent source and later shared or cited by a verified newsroom.

## Context Claims and Flags

Veritas now lets an uploader attach context to a registration:

- Claimed location
- Claimed event date
- Subject or people involved
- Short description
- Reference URL

Viewers can flag a record if the claimed location, date, subject, or description appears wrong. A flag does not delete or rewrite the original registration. It records a dispute against the context. In the current app these records go to Supabase when the project URL and publishable key are configured.

Uploaders can also open the My Videos page, connect the same wallet used for registration, and see the context records registered by that wallet. This lets them add or update the original/public video URL after registration.

Off-chain changes such as saving context, updating a URL, or adding a newsroom citation require a Phantom message signature. This proves that the database change was requested by the wallet shown in the record.

When context is saved or updated, Veritas hashes the context package and sends that hash to Solana as a Memo transaction. Supabase stores the full context, while Solana stores the public timestamped commitment to that context hash.

## Chain of Custody

Veritas now has a prototype chain-of-custody citation flow. If a Tier 1 verified newsroom wallet cites a record registered by an independent source, that citation is stored with the context record. This helps distinguish a self-registered independent record from a record that was later acknowledged by a verified newsroom.

## What the Watermark Is For

The watermark ID is the link between the video file and the Solana record.

The metadata watermark is fast and accurate when the file has not been heavily modified, but metadata can be stripped by platforms or editing tools.

The hidden visual watermark is intended to survive more changes, such as normal re-encoding or compression. In current testing it survives metadata removal and moderate compression, but it can fail after aggressive resizing or extreme social-media-style compression.

## What Veritas Can Prove Today

Veritas can currently show that:

- A video contains a Veritas watermark ID.
- That ID maps to a record in the Veritas Solana program.
- The record identifies the registered source and uploader wallet.
- The original uploaded video fingerprint is stored for reference.

This is useful for provenance: it helps show that a video was registered by a particular source at a particular time.

## What Veritas Does Not Prove Yet

Veritas does not prove that the content of the video is objectively true.

It also does not fully prevent every possible attack. New VideoHash-backed records can reject many copied-watermark replay attempts when the uploaded video fingerprint does not match the registered video. This is still not a complete replacement for stronger signed payloads and production source management.

Future versions should add stronger protections, such as signed watermark payloads, private server-side watermarking keys, better visual fingerprinting, and stronger source management.

## Current Strengths

The current app already demonstrates the main provenance flow end to end:

- Uploading works.
- Backend watermarking works.
- Video hashing works.
- Phantom wallet signing works.
- Solana devnet registration works.
- Verification works through metadata.
- Verification can fall back to the hidden visual watermark when metadata is stripped.
- The app explains when verification fails instead of implying that the video is automatically false.

## Current Limitations

The current version is still a hackathon MVP.

The hidden watermark is experimental. It works well under some realistic transformations, but it does not reliably survive aggressive resizing and heavy compression.

The backend job storage is also local and in-memory, which is acceptable for a demo but not enough for production. A production version would need durable storage for job state, generated files, source assignments, and audit records.

## Project Goal

The goal of Veritas is to create a practical, understandable trust layer for news video provenance.

The main value is not that it replaces journalism, moderation, or fact-checking. The value is that it gives viewers and newsrooms a verifiable way to answer:

> Can this video be linked back to a source that Veritas recognizes?

That makes it easier to distinguish registered source-backed footage from unverified copies circulating online.

## Demo Social Feed

The project includes a mock social page at `/mock-social`. It contains three posts for demonstrations:

- A verified original post
- An unverified post
- An excerpt of a verified original with a different caption

The included videos are small placeholders and can be replaced with real clips later.
