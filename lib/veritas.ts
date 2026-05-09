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
  // Lazy-load ffmpeg only when needed.
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile } = await import("@ffmpeg/util");

  const ffmpeg = new FFmpeg();
  const logs: string[] = [];

  ffmpeg.on("log", ({ message }) => {
    logs.push(message);
    if (logs.length > 20) logs.shift();
  });

  // Let @ffmpeg/ffmpeg load its matching default core version.
  try {
    await ffmpeg.load();
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const isolationStatus =
      typeof crossOriginIsolated === "boolean"
        ? `crossOriginIsolated=${crossOriginIsolated}`
        : "crossOriginIsolated=unavailable";

    throw new Error(
      `Could not load the browser video processor. ${isolationStatus}. ${details}`
    );
  }

  // PDA seeds have a 32-byte max. A UUID with hyphens is 36 chars, so store
  // the same 128-bit value as 32 lowercase hex chars.
  const watermarkId = uuidv4().replace(/-/g, "");
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const inputName = `input.${extension}`;
  const outputName = "output.mp4";
  const timestamp = Date.now();

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    // First try stream copy: fast, no quality loss, but not every codec can be
    // remuxed into MP4. Custom MP4 metadata needs use_metadata_tags.
    try {
      await ffmpeg.exec([
        "-y",
        "-i", inputName,
        "-map", "0",
        "-c", "copy",
        "-movflags", "use_metadata_tags",
        "-metadata", `veritas_id=${watermarkId}`,
        "-metadata", `veritas_ts=${timestamp}`,
        outputName,
      ]);
    } catch {
      logs.push("Stream-copy watermarking failed; retrying with MP4 transcode.");

      await ffmpeg.exec([
        "-y",
        "-i", inputName,
        "-map", "0:v:0",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "28",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "use_metadata_tags",
        "-metadata", `veritas_id=${watermarkId}`,
        "-metadata", `veritas_ts=${timestamp}`,
        outputName,
      ]);
    }

    const data = await ffmpeg.readFile(outputName);
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const watermarkedBlob = new Blob([arrayBuffer], { type: "video/mp4" });

    return { watermarkId, watermarkedBlob };
  } catch (error) {
    const details = logs.slice(-8).join("\n");
    throw new Error(
      details
        ? `Could not embed the watermark. ffmpeg said:\n${details}`
        : "Could not embed the watermark. Try a smaller MP4 file for the demo."
    );
  } finally {
    ffmpeg.terminate();
  }
}

// Extract the Veritas watermark ID from MP4 metadata.
export async function extractWatermarkId(file: File): Promise<string | null> {
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile } = await import("@ffmpeg/util");

  const ffmpeg = new FFmpeg();
  const logs: string[] = [];

  ffmpeg.on("log", ({ message }) => {
    logs.push(message);
    if (logs.length > 20) logs.shift();
  });

  try {
    await ffmpeg.load();
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const isolationStatus =
      typeof crossOriginIsolated === "boolean"
        ? `crossOriginIsolated=${crossOriginIsolated}`
        : "crossOriginIsolated=unavailable";

    throw new Error(
      `Could not load the browser video processor. ${isolationStatus}. ${details}`
    );
  }

  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const inputName = `verify.${extension}`;
  const metadataName = "metadata.txt";

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    await ffmpeg.exec([
      "-y",
      "-i", inputName,
      "-f", "ffmetadata",
      metadataName,
    ]);

    const data = await ffmpeg.readFile(metadataName, "utf8");
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    const metadata = parseFfmpegMetadata(text);
    return metadata.veritas_id ?? null;
  } catch {
    const details = logs.slice(-8).join("\n");
    throw new Error(
      details
        ? `Could not read the Veritas watermark. ffmpeg said:\n${details}`
        : "Could not read the Veritas watermark from this video."
    );
  } finally {
    ffmpeg.terminate();
  }
}

function parseFfmpegMetadata(text: string): Record<string, string> {
  const metadata: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#") || line.startsWith("[")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    metadata[key] = value;
  }

  return metadata;
}

// ─── 3. Solana devnet client ───────────────────────────────────────────────

// The Program ID must match Anchor.toml and programs/veritas/src/lib.rs.
export const PROGRAM_ID = new PublicKey(
  "4qBS9B7cZ5r4CeNMaRvxELmZugRroXUwRg8Ss4MP3CVi"
);

export const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

const VIDEO_RECORD_DISCRIMINATOR = Buffer.from([
  0x40, 0x86, 0x1b, 0x88, 0x73, 0xc7, 0x00, 0x1d,
]);

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
    if (!accountInfo.owner.equals(PROGRAM_ID)) return null;
    if (accountInfo.data.length < VIDEO_RECORD_DISCRIMINATOR.length) return null;
    if (!Buffer.from(accountInfo.data.slice(0, 8)).equals(VIDEO_RECORD_DISCRIMINATOR)) {
      return null;
    }

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
function readString(buf: Buffer, offset: number, maxLength = 256): [string, number] {
  if (offset + 4 > buf.length) throw new Error("Invalid string offset");
  const len = buf.readUInt32LE(offset);
  if (len > maxLength) throw new Error("Invalid string length");
  if (offset + 4 + len > buf.length) throw new Error("Invalid string data");
  const str = buf.slice(offset + 4, offset + 4 + len).toString("utf8");
  return [str, offset + 4 + len];
}

function deserializeVideoRecord(data: Buffer): VideoRecord {
  let offset = 8; // skip 8-byte discriminator
  const [watermarkId, o1] = readString(data, offset, 32); offset = o1;
  const [videoHash, o2] = readString(data, offset, 64);   offset = o2;
  const [sourceId, o3] = readString(data, offset, 32);    offset = o3;
  const [sourceName, o4] = readString(data, offset, 64);  offset = o4;
  if (offset + 8 + 32 > data.length) throw new Error("Invalid record data");
  const timestamp = Number(data.readBigInt64LE(offset)); offset += 8;
  const registeredBy = new PublicKey(data.slice(offset, offset + 32)).toBase58();

  return { watermarkId, videoHash, sourceId, sourceName, timestamp, registeredBy };
}
