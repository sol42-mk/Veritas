// lib/veritas.ts
// Three pure helpers used by both the register and verify pages.
// No React, no side effects; easy to test in isolation.

import { v4 as uuidv4 } from "uuid";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";

// ─── 1. Hashing ────────────────────────────────────────────────────────────

// Compute SHA-256 of a File in the browser using the Web Crypto API.
// Returns a lowercase hex string. This goes on-chain as the proof of content.
export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── 2. Watermarking ───────────────────────────────────────────────────────

// Embed a UUID into the video's MP4 metadata using ffmpeg.wasm.
// This is the "fake but functional" approach for the hackathon:
// it survives local file transfers but not social media re-encoding.
// The UUID is the key that maps to the on-chain record.
//
// Returns: { watermarkId, watermarkedBlob }
export async function embedWatermark(
  file: File
): Promise<{ watermarkId: string; watermarkedBlob: Blob }> {
  // Lazy-load ffmpeg only when needed (it's ~30MB)
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile, toBlobURL } = await import("@ffmpeg/util");

  const ffmpeg = new FFmpeg();

  // Load ffmpeg.wasm core from CDN
  await ffmpeg.load({
    coreURL: await toBlobURL(
      "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js",
      "text/javascript"
    ),
    wasmURL: await toBlobURL(
      "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm",
      "application/wasm"
    ),
  });

  const watermarkId = uuidv4();
  const inputName = "input.mp4";
  const outputName = "output.mp4";

  // Write the input file into ffmpeg's virtual filesystem
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  // Copy the video stream and embed our watermark_id as a metadata tag.
  // -c copy = no re-encoding, fast. The metadata tag is our lookup key.
  await ffmpeg.exec([
    "-i", inputName,
    "-c", "copy",
    "-metadata", `veritas_id=${watermarkId}`,
    "-metadata", `veritas_ts=${Date.now()}`,
    outputName,
  ]);

  const data = await ffmpeg.readFile(outputName);
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const watermarkedBlob = new Blob([arrayBuffer], { type: "video/mp4" });

  return { watermarkId, watermarkedBlob };
}

// ─── 3. Solana devnet client ───────────────────────────────────────────────

// The Program ID must match Anchor.toml and programs/veritas/src/lib.rs.
export const PROGRAM_ID = new PublicKey(
  "4qBS9B7cZ5r4CeNMaRvxELmZugRroXUwRg8Ss4MP3CVi"
);

export const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

// Derive the PDA address for a given watermark ID.
// This is deterministic: the same ID always gives the same address,
// so verification doesn't need to store a lookup table.
export function getVideoPDA(watermarkId: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("video"), Buffer.from(watermarkId)],
    PROGRAM_ID
  );
}

// Fetch and decode a VideoRecord from chain.
// Returns null if the record doesn't exist (= unverified video).
export async function fetchVideoRecord(
  watermarkId: string
): Promise<VideoRecord | null> {
  try {
    const [pda] = getVideoPDA(watermarkId);
    const accountInfo = await connection.getAccountInfo(pda);
    if (!accountInfo) return null;

    // Manual deserialization: skip the 8-byte Anchor discriminator,
    // then read each field in the order they're defined in the Rust struct.
    return deserializeVideoRecord(accountInfo.data);
  } catch {
    return null;
  }
}

export interface VideoRecord {
  watermarkId: string;
  videoHash: string;
  sourceId: string;
  sourceName: string;
  timestamp: number;
  registeredBy: string;
}

// Anchor serializes strings as: 4-byte LE length prefix + UTF-8 bytes.
function readString(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset);
  const str = buf.slice(offset + 4, offset + 4 + len).toString("utf8");
  return [str, offset + 4 + len];
}

function deserializeVideoRecord(data: Buffer): VideoRecord {
  let offset = 8; // skip 8-byte discriminator
  const [watermarkId, o1] = readString(data, offset); offset = o1;
  const [videoHash, o2] = readString(data, offset);   offset = o2;
  const [sourceId, o3] = readString(data, offset);    offset = o3;
  const [sourceName, o4] = readString(data, offset);  offset = o4;
  const timestamp = Number(data.readBigInt64LE(offset)); offset += 8;
  const registeredBy = new PublicKey(data.slice(offset, offset + 32)).toBase58();

  return { watermarkId, videoHash, sourceId, sourceName, timestamp, registeredBy };
}
