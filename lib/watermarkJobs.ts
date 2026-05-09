import { randomUUID } from "crypto";
import { embedServerWatermark, type ServerWatermarkResult, type WatermarkProgress } from "@/lib/serverDctWatermark";

type WatermarkJobStatus = "queued" | "running" | "completed" | "failed";

export interface WatermarkJobSnapshot {
  id: string;
  status: WatermarkJobStatus;
  message: string;
  progress: number;
  startedAt: number;
  updatedAt: number;
  elapsedMs: number;
  currentFrame?: number;
  totalFrames?: number;
  watermarkId?: string;
  videoHash?: string;
  method?: "metadata+dct-spread-spectrum" | "metadata-only";
  warning?: string;
  error?: string;
}

interface WatermarkJob extends Omit<WatermarkJobSnapshot, "elapsedMs"> {
  fileName: string;
  result?: ServerWatermarkResult;
}

const JOB_TTL_MS = 15 * 60 * 1000;

declare global {
  var __veritasWatermarkJobs: Map<string, WatermarkJob> | undefined;
}

const jobs = globalThis.__veritasWatermarkJobs ?? new Map<string, WatermarkJob>();
globalThis.__veritasWatermarkJobs = jobs;

export function createWatermarkJob(file: File): WatermarkJobSnapshot {
  cleanupOldJobs();

  const now = Date.now();
  const id = randomUUID();
  const job: WatermarkJob = {
    id,
    status: "queued",
    fileName: file.name,
    message: "Queued backend watermark job...",
    progress: 0,
    startedAt: now,
    updatedAt: now,
  };

  jobs.set(id, job);
  void runWatermarkJob(job, file);

  return toSnapshot(job);
}

export function getWatermarkJob(id: string): WatermarkJobSnapshot | null {
  const job = jobs.get(id);
  return job ? toSnapshot(job) : null;
}

export function getWatermarkJobDownload(id: string): {
  fileName: string;
  result: ServerWatermarkResult;
} | null {
  const job = jobs.get(id);
  if (!job || job.status !== "completed" || !job.result) return null;

  return {
    fileName: job.fileName,
    result: job.result,
  };
}

async function runWatermarkJob(job: WatermarkJob, file: File) {
  updateJob(job, {
    status: "running",
    message: "Starting backend watermark worker...",
    progress: 0.01,
  });

  try {
    const result = await embedServerWatermark(file, (progress) => {
      updateJob(job, progress);
    });

    job.result = result;
    updateJob(job, {
      status: "completed",
      message: result.robust
        ? "Watermarked MP4 is ready."
        : "Metadata-only MP4 is ready.",
      progress: 1,
      watermarkId: result.watermarkId,
      videoHash: result.videoHash,
      method: result.robust ? "metadata+dct-spread-spectrum" : "metadata-only",
      warning: result.warning,
    });
  } catch (error) {
    updateJob(job, {
      status: "failed",
      message: "Watermark job failed.",
      error: error instanceof Error ? error.message : "Could not watermark this video.",
    });
  }
}

function updateJob(job: WatermarkJob, patch: Partial<WatermarkJobSnapshot> | WatermarkProgress) {
  Object.assign(job, patch, { updatedAt: Date.now() });
}

function toSnapshot(job: WatermarkJob): WatermarkJobSnapshot {
  const {
    result: _result,
    fileName: _fileName,
    ...snapshot
  } = job;

  return {
    ...snapshot,
    elapsedMs: Date.now() - job.startedAt,
  };
}

function cleanupOldJobs() {
  const now = Date.now();

  for (const [id, job] of jobs.entries()) {
    if (now - job.updatedAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}
