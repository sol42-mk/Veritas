// lib/veritas.ts
// Three pure helpers used by both the register and verify pages.
// No React, no side effects; easy to test in isolation.

import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";

// ─── 2. Watermarking ───────────────────────────────────────────────────────

export interface WatermarkJobProgress {
  message: string;
  progress: number;
  elapsedMs: number;
  currentFrame?: number;
  totalFrames?: number;
}

interface WatermarkJobSnapshot extends WatermarkJobProgress {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  watermarkId?: string;
  videoHash?: string;
  method?: "metadata+dct-spread-spectrum" | "metadata-only";
  warning?: string;
  error?: string;
}

// Ask the backend worker to embed the Veritas ID into metadata and frames.
// The UUID is the key that maps the video to the on-chain record.
//
// Returns: { watermarkId, videoHash, watermarkedBlob }
export async function embedWatermark(
  file: File,
  onProgress?: (progress: WatermarkJobProgress) => void
): Promise<{ watermarkId: string; videoHash: string; watermarkedBlob: Blob }> {
  const startedAt = Date.now();
  const emit = (progress: Omit<WatermarkJobProgress, "elapsedMs"> & { elapsedMs?: number }) => {
    onProgress?.({ ...progress, elapsedMs: progress.elapsedMs ?? Date.now() - startedAt });
  };

  emit({ message: "Uploading video to backend worker...", progress: 0.02 });

  const formData = new FormData();
  formData.append("video", file);

  const createResponse = await fetch("/api/watermark/jobs", {
    method: "POST",
    body: formData,
  });

  if (!createResponse.ok) {
    const body = await createResponse.json().catch(() => null);
    throw new Error(body?.error ?? "The backend worker could not watermark this video.");
  }

  const created = await createResponse.json() as { job?: WatermarkJobSnapshot };
  if (!created.job?.id) {
    throw new Error("The backend worker did not return a watermark job ID.");
  }

  let job = created.job;
  emit(job);

  while (job.status === "queued" || job.status === "running") {
    await sleep(500);

    const statusResponse = await fetch(`/api/watermark/jobs?jobId=${encodeURIComponent(job.id)}`, {
      cache: "no-store",
    });

    if (!statusResponse.ok) {
      const body = await statusResponse.json().catch(() => null);
      throw new Error(body?.error ?? "Could not read watermark job progress.");
    }

    const body = await statusResponse.json() as { job?: WatermarkJobSnapshot };
    if (!body.job) {
      throw new Error("The backend worker returned an invalid job progress response.");
    }

    job = body.job;
    emit(job);
  }

  if (job.status === "failed") {
    throw new Error(job.error ?? "The backend worker could not watermark this video.");
  }

  emit({ ...job, message: "Downloading watermarked video from backend worker...", progress: 0.98 });

  const downloadResponse = await fetch(`/api/watermark/jobs?jobId=${encodeURIComponent(job.id)}&download=1`, {
    cache: "no-store",
  });

  if (!downloadResponse.ok) {
    const body = await downloadResponse.json().catch(() => null);
    throw new Error(body?.error ?? "Could not download the watermarked video.");
  }

  const watermarkId = downloadResponse.headers.get("X-Veritas-Watermark-Id") ?? job.watermarkId;
  const videoHash = downloadResponse.headers.get("X-Veritas-Original-Sha256") ?? job.videoHash;
  const watermarkedBlob = await downloadResponse.blob();

  if (!watermarkId || !/^[a-f0-9]{32}$/i.test(watermarkId)) {
    throw new Error("The backend worker did not return a valid watermark ID.");
  }

  if (!videoHash || !/^[a-f0-9]{64}$/i.test(videoHash)) {
    throw new Error("The backend worker did not return a valid video hash.");
  }

  if (watermarkedBlob.size === 0) {
    throw new Error("The backend worker returned an empty watermarked video.");
  }

  emit({ message: "Final watermarked MP4 is ready.", progress: 1 });
  return { watermarkId: watermarkId.toLowerCase(), videoHash: videoHash.toLowerCase(), watermarkedBlob };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Extract the Veritas watermark ID from MP4 metadata.
export async function extractWatermarkId(file: File): Promise<string | null> {
  const extracted = await extractWatermark(file);
  return extracted?.trusted === false ? null : extracted?.watermarkId ?? null;
}

export interface ExtractedWatermark {
  watermarkId: string;
  method: "metadata" | "dct-spread-spectrum";
  uploadedHash: string;
  trusted: boolean;
  rejectionReason?: string;
  confidence?: number;
  framesAnalyzed?: number;
  extractionWidth?: number;
  extractionHeight?: number;
  xOffset?: number;
  yOffset?: number;
  candidatesTested?: number;
}

export async function extractWatermark(file: File): Promise<ExtractedWatermark | null> {
  const formData = new FormData();
  formData.append("video", file);

  const response = await fetch("/api/extract-watermark", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "The backend worker could not extract a Veritas watermark.");
  }

  const body = await response.json() as { watermark?: ExtractedWatermark | null };
  return body.watermark ?? null;
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
