import { spawn } from "child_process";
import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const TARGET_WIDTH = 640;
const DEFAULT_MAX_OUTPUT_FPS = 30;
const BIT_REPETITIONS = 20;
const DCT_STRENGTH = 48;
const MAX_LUMA_DELTA = 14;
const DETECTION_FRAMES = 12;
const COEFF_A: [number, number] = [3, 4];
const COEFF_B: [number, number] = [4, 3];
const CUDA_WORKER_PATH = path.join(process.cwd(), "workers", "cuda-dct", "veritas_cuda_dct.py");

interface VideoInfo {
  width: number;
  height: number;
  duration: number;
  fps: number;
}

interface EmbeddingPoint {
  bitIndex: number;
  x: number;
  y: number;
}

export interface ServerWatermarkResult {
  watermarkId: string;
  videoHash: string;
  video: Buffer;
  robust: boolean;
  warning?: string;
}

export interface ServerWatermarkDetection {
  watermarkId: string;
  method: "metadata" | "dct-spread-spectrum";
  uploadedHash: string;
  confidence?: number;
  framesAnalyzed?: number;
}

interface CommandResult {
  stdout: Buffer;
  stderr: string;
}

export interface WatermarkProgress {
  message: string;
  progress: number;
  currentFrame?: number;
  totalFrames?: number;
}

type ProgressReporter = (progress: WatermarkProgress) => void;

export async function embedServerWatermark(
  file: File,
  onProgress?: ProgressReporter
): Promise<ServerWatermarkResult> {
  const workDir = await makeWorkDir();
  const inputPath = path.join(workDir, safeInputName(file.name));
  const robustOutputPath = path.join(workDir, "robust-watermarked.mp4");
  const metadataOutputPath = path.join(workDir, "metadata-watermarked.mp4");
  const watermarkId = randomUUID().replace(/-/g, "");
  const emit = makeProgressEmitter(onProgress);

  try {
    emit({ message: "Reading uploaded video...", progress: 0.03 });
    const input = Buffer.from(await file.arrayBuffer());
    emit({ message: "Computing SHA-256 hash on the backend...", progress: 0.06 });
    const videoHash = sha256(input);
    await writeFile(inputPath, input);

    try {
      await embedDctWatermark(inputPath, robustOutputPath, watermarkId, emit);
      emit({ message: "Reading final watermarked MP4...", progress: 0.96 });
      const video = await readFile(robustOutputPath);
      if (video.length === 0) throw new Error("DCT worker produced an empty video.");
      emit({ message: "Watermarked MP4 is ready.", progress: 1 });
      return { watermarkId, videoHash, video, robust: true };
    } catch (error) {
      const warning = error instanceof Error ? error.message : String(error);
      emit({ message: "DCT watermark failed; falling back to metadata-only MP4...", progress: 0.55 });
      await embedMetadataOnly(inputPath, metadataOutputPath, watermarkId);
      emit({ message: "Reading metadata-only MP4...", progress: 0.9 });
      const video = await readFile(metadataOutputPath);
      if (video.length === 0) throw new Error("Metadata fallback produced an empty video.");
      emit({ message: "Metadata-only MP4 is ready.", progress: 1 });
      return { watermarkId, videoHash, video, robust: false, warning };
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function extractServerWatermark(file: File): Promise<ServerWatermarkDetection | null> {
  const workDir = await makeWorkDir();
  const inputPath = path.join(workDir, safeInputName(file.name));

  try {
    const input = Buffer.from(await file.arrayBuffer());
    const uploadedHash = sha256(input);
    await writeFile(inputPath, input);

    const metadataWatermarkId = await extractMetadataWatermark(inputPath);
    if (metadataWatermarkId) {
      return { watermarkId: metadataWatermarkId, method: "metadata", uploadedHash };
    }

    const detection = await extractDctWatermark(inputPath);
    return detection ? { ...detection, uploadedHash } : null;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function sha256(input: Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

async function makeWorkDir(): Promise<string> {
  const dir = path.join(tmpdir(), `veritas-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function safeInputName(name: string): string {
  const extension = path.extname(name).replace(/[^a-zA-Z0-9.]/g, "") || ".mp4";
  return `input${extension}`;
}

function makeProgressEmitter(onProgress?: ProgressReporter): ProgressReporter {
  let lastProgress = 0;

  return (progress) => {
    const nextProgress = Math.max(lastProgress, Math.max(0, Math.min(1, progress.progress)));
    lastProgress = nextProgress;
    onProgress?.({ ...progress, progress: nextProgress });
  };
}

async function embedDctWatermark(
  inputPath: string,
  outputPath: string,
  watermarkId: string,
  onProgress: ProgressReporter
) {
  if (process.env.VERITAS_DCT_BACKEND === "cuda") {
    try {
      await embedCudaDctWatermark(inputPath, outputPath, watermarkId, onProgress);
      return;
    } catch (error) {
      if (process.env.VERITAS_DCT_FALLBACK === "none") {
        throw error;
      }

      const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
      onProgress({
        message: `CUDA DCT worker failed; falling back to CPU DCT. ${reason}`,
        progress: 0.09,
      });
    }
  }

  await embedCpuDctWatermark(inputPath, outputPath, watermarkId, onProgress);
}

async function embedCudaDctWatermark(
  inputPath: string,
  outputPath: string,
  watermarkId: string,
  onProgress: ProgressReporter
) {
  onProgress({ message: "Starting CUDA DCT worker...", progress: 0.08 });
  const info = await getVideoInfo(inputPath);
  const { width, height } = getProcessingSize(info.width, info.height);
  const outputFps = getWatermarkFps(info.fps);
  const totalFrames = Math.max(1, Math.ceil(info.duration * outputFps));
  const python = process.env.VERITAS_CUDA_PYTHON || "python3";
  const workerPath = process.env.VERITAS_CUDA_DCT_WORKER || CUDA_WORKER_PATH;
  const args = [
    workerPath,
    "--input", inputPath,
    "--output", outputPath,
    "--watermark-id", watermarkId,
    "--width", String(width),
    "--height", String(height),
    "--fps", String(outputFps),
    "--total-frames", String(totalFrames),
    "--bit-repetitions", String(BIT_REPETITIONS),
    "--dct-strength", String(DCT_STRENGTH),
    "--max-luma-delta", String(MAX_LUMA_DELTA),
    "--ffmpeg", getFfmpegPath(),
  ];

  await runProgressCommand(python, args, onProgress);
}

async function embedCpuDctWatermark(
  inputPath: string,
  outputPath: string,
  watermarkId: string,
  onProgress: ProgressReporter
) {
  onProgress({ message: "Reading video dimensions and duration...", progress: 0.08 });
  const info = await getVideoInfo(inputPath);
  const { width, height } = getProcessingSize(info.width, info.height);
  const outputFps = getWatermarkFps(info.fps);
  createEmbeddingPlan(width, height);
  const frameSize = width * height * 3;
  const totalFrames = Math.max(1, Math.ceil(info.duration * outputFps));
  const decodeArgs = [
    "-i", inputPath,
    "-vf", `scale=${width}:${height},fps=${outputFps}`,
    "-f", "rawvideo",
    "-pix_fmt", "rgb24",
    "pipe:1",
  ];
  const encodeArgs = [
    "-y",
    "-f", "rawvideo",
    "-pix_fmt", "rgb24",
    "-s", `${width}x${height}`,
    "-r", String(outputFps),
    "-i", "pipe:0",
    "-i", inputPath,
    "-map", "0:v:0",
    "-map", "1:a?",
    ...getVideoEncoderArgs(),
    "-c:a", "aac",
    "-b:a", "128k",
    "-shortest",
    "-movflags", "use_metadata_tags",
    "-metadata", `veritas_id=${watermarkId}`,
    "-metadata", "veritas_watermark=metadata+dct-spread-spectrum",
    outputPath,
  ];

  const decoder = spawn(getFfmpegPath(), decodeArgs);
  const encoder = spawn(getFfmpegPath(), encodeArgs);
  const decoderErrors: Buffer[] = [];
  const encoderErrors: Buffer[] = [];
  const pending: Buffer[] = [];
  let pendingLength = 0;
  let frameIndex = 0;
  let lastProgressAt = 0;

  decoder.stderr.on("data", (chunk) => decoderErrors.push(Buffer.from(chunk)));
  encoder.stderr.on("data", (chunk) => encoderErrors.push(Buffer.from(chunk)));

  try {
    onProgress({
      message: `Embedding DCT watermark into ${width}x${height} frames...`,
      progress: 0.1,
      currentFrame: 0,
      totalFrames,
    });
    const decoderDone = waitForProcess(decoder, "ffmpeg decoder", decoderErrors);
    const encoderDone = waitForProcess(encoder, "ffmpeg encoder", encoderErrors);

    for await (const chunk of decoder.stdout) {
      pending.push(Buffer.from(chunk));
      pendingLength += chunk.length;

      while (pendingLength >= frameSize) {
        const frame = takeFrame(pending, frameSize);
        pendingLength -= frameSize;
        embedWatermarkIntoFrame(frame, width, height, watermarkId);

        if (!encoder.stdin.write(frame)) {
          await onceDrain(encoder.stdin);
        }

        frameIndex += 1;
        const now = Date.now();
        if (frameIndex === 1 || frameIndex >= totalFrames || now - lastProgressAt > 400) {
          lastProgressAt = now;
          onProgress({
            message: `Embedding DCT watermark into frame ${Math.min(frameIndex, totalFrames)} of ${totalFrames}...`,
            progress: 0.1 + Math.min(frameIndex / totalFrames, 1) * 0.75,
            currentFrame: frameIndex,
            totalFrames,
          });
        }
      }
    }

    const decoderCode = await decoderDone;
    onProgress({
      message: "Finalizing MP4 encode and audio track...",
      progress: 0.88,
      currentFrame: frameIndex,
      totalFrames,
    });
    encoder.stdin.end();
    await encoderDone;

    if (decoderCode !== 0) {
      throw new Error("ffmpeg failed to decode video for DCT watermarking.");
    }

    if (frameIndex === 0) {
      throw new Error("No video frames were decoded for DCT watermarking.");
    }

    onProgress({
      message: "Backend DCT watermark finished.",
      progress: 0.94,
      currentFrame: frameIndex,
      totalFrames,
    });
  } catch (error) {
    decoder.kill("SIGKILL");
    encoder.kill("SIGKILL");
    throw error;
  }
}

async function embedMetadataOnly(inputPath: string, outputPath: string, watermarkId: string) {
  const args = [
    "-y",
    "-i", inputPath,
    "-map", "0:v:0",
    "-map", "0:a?",
    ...getVideoEncoderArgs(),
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "use_metadata_tags",
    "-metadata", `veritas_id=${watermarkId}`,
    "-metadata", "veritas_watermark=metadata-only",
    outputPath,
  ];

  await runCommand(getFfmpegPath(), args);
}

async function extractMetadataWatermark(inputPath: string): Promise<string | null> {
  const result = await runCommand(getFfprobePath(), [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    inputPath,
  ]);
  const parsed = JSON.parse(result.stdout.toString("utf8")) as {
    format?: { tags?: Record<string, string> };
  };
  const tags = parsed.format?.tags ?? {};
  const value = tags.veritas_id ?? tags.VERITAS_ID;

  return value && /^[a-f0-9]{32}$/i.test(value) ? value.toLowerCase() : null;
}

async function extractDctWatermark(
  inputPath: string
): Promise<Omit<ServerWatermarkDetection, "uploadedHash"> | null> {
  const info = await getVideoInfo(inputPath);
  const { width, height } = getExtractionSize(info.width, info.height);
  const frameSize = width * height * 3;
  const sampleFps = Math.max(1, Math.min(4, Math.ceil(DETECTION_FRAMES / Math.max(1, info.duration))));
  const args = [
    "-i", inputPath,
    "-vf", `scale=${width}:${height},fps=${sampleFps}`,
    "-frames:v", String(DETECTION_FRAMES),
    "-f", "rawvideo",
    "-pix_fmt", "rgb24",
    "pipe:1",
  ];
  const result = await runCommand(getFfmpegPath(), args);
  const votes = new Array(128).fill(0) as number[];
  const frameCount = Math.floor(result.stdout.length / frameSize);

  for (let i = 0; i < frameCount; i += 1) {
    const frame = result.stdout.subarray(i * frameSize, (i + 1) * frameSize);
    accumulateFrameVotes(frame, width, height, votes);
  }

  if (frameCount === 0) return null;

  const bits = votes.map((vote) => (vote >= 0 ? 1 : 0));
  const watermarkId = bitsToHex(bits);
  const maxVotes = frameCount * BIT_REPETITIONS;
  const confidence =
    votes.reduce((sum, vote) => sum + Math.abs(vote), 0) / (votes.length * maxVotes);

  return {
    watermarkId,
    method: "dct-spread-spectrum",
    confidence,
    framesAnalyzed: frameCount,
  };
}

async function getVideoInfo(inputPath: string): Promise<VideoInfo> {
  const result = await runCommand(getFfprobePath(), [
    "-v", "quiet",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    inputPath,
  ]);
  const parsed = JSON.parse(result.stdout.toString("utf8")) as {
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
    }>;
    format?: { duration?: string };
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");

  if (!video?.width || !video.height) {
    throw new Error("Could not read video dimensions.");
  }

  return {
    width: video.width,
    height: video.height,
    duration: Number.parseFloat(parsed.format?.duration ?? "1") || 1,
    fps: parseFrameRate(video.avg_frame_rate ?? video.r_frame_rate) ?? 24,
  };
}

function parseFrameRate(value?: string): number | null {
  if (!value || value === "0/0") return null;
  const [numerator, denominator] = value.split("/").map(Number);

  if (!Number.isFinite(numerator)) return null;
  if (!Number.isFinite(denominator) || denominator === 0) {
    return numerator > 0 ? numerator : null;
  }

  const fps = numerator / denominator;
  return fps > 0 ? fps : null;
}

function getWatermarkFps(sourceFps: number): number {
  const explicitFps = Number(process.env.VERITAS_WATERMARK_FPS);
  if (Number.isFinite(explicitFps) && explicitFps > 0) {
    return roundFps(explicitFps);
  }

  const maxFps = Number(process.env.VERITAS_MAX_WATERMARK_FPS) || DEFAULT_MAX_OUTPUT_FPS;
  return roundFps(Math.max(1, Math.min(sourceFps || 24, maxFps)));
}

function roundFps(fps: number): number {
  return Math.round(fps * 1000) / 1000;
}

function getProcessingSize(videoWidth: number, videoHeight: number) {
  const scale = videoWidth > TARGET_WIDTH ? TARGET_WIDTH / videoWidth : 1;
  const width = Math.max(320, Math.floor(videoWidth * scale));
  const height = Math.max(180, Math.floor(videoHeight * scale));

  return {
    width: width - (width % 8),
    height: height - (height % 8),
  };
}

function getExtractionSize(videoWidth: number, videoHeight: number) {
  const scale = TARGET_WIDTH / videoWidth;
  const width = TARGET_WIDTH;
  const height = Math.max(180, Math.floor(videoHeight * scale));

  return {
    width: width - (width % 8),
    height: height - (height % 8),
  };
}

function getFfmpegPath(): string {
  return process.env.VERITAS_FFMPEG_PATH || path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");
}

function getFfprobePath(): string {
  return process.env.VERITAS_FFPROBE_PATH || path.join(process.cwd(), "node_modules", "ffprobe-static", "bin", "linux", "x64", "ffprobe");
}

function getVideoEncoderArgs(): string[] {
  if (process.env.VERITAS_VIDEO_ENCODER === "nvenc") {
    return [
      "-c:v", "h264_nvenc",
      "-preset", process.env.VERITAS_NVENC_PRESET || "p4",
      "-cq", process.env.VERITAS_NVENC_CQ || "23",
      "-pix_fmt", "yuv420p",
    ];
  }

  return [
    "-c:v", "libx264",
    "-preset", process.env.VERITAS_X264_PRESET || "ultrafast",
    "-crf", process.env.VERITAS_X264_CRF || "23",
    "-pix_fmt", "yuv420p",
  ];
}

function takeFrame(chunks: Buffer[], frameSize: number): Buffer {
  const frame = Buffer.allocUnsafe(frameSize);
  let offset = 0;

  while (offset < frameSize) {
    const first = chunks[0];
    const needed = frameSize - offset;

    if (first.length <= needed) {
      first.copy(frame, offset);
      offset += first.length;
      chunks.shift();
    } else {
      first.copy(frame, offset, 0, needed);
      chunks[0] = first.subarray(needed);
      offset += needed;
    }
  }

  return frame;
}

function onceDrain(stream: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve) => stream.once("drain", resolve));
}

function waitForProcess(
  child: ReturnType<typeof spawn>,
  label: string,
  stderrChunks: Buffer[]
): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code && code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8").slice(-2000);
        reject(new Error(`${label} exited with code ${code}.\n${stderr}`));
        return;
      }

      resolve(code ?? 0);
    });
  });
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (code && code !== 0) {
        reject(new Error(`${path.basename(command)} exited with code ${code}.\n${stderrText.slice(-2000)}`));
        return;
      }

      resolve({ stdout: Buffer.concat(stdout), stderr: stderrText });
    });
  });
}

function runProgressCommand(
  command: string,
  args: string[],
  onProgress: ProgressReporter
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        VERITAS_VIDEO_ENCODER: process.env.VERITAS_VIDEO_ENCODER || "",
        VERITAS_X264_PRESET: process.env.VERITAS_X264_PRESET || "",
        VERITAS_X264_CRF: process.env.VERITAS_X264_CRF || "",
        VERITAS_NVENC_PRESET: process.env.VERITAS_NVENC_PRESET || "",
        VERITAS_NVENC_CQ: process.env.VERITAS_NVENC_CQ || "",
      },
    });
    const stderr: Buffer[] = [];
    let stdoutRemainder = "";

    child.stdout.on("data", (chunk) => {
      stdoutRemainder += Buffer.from(chunk).toString("utf8");
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const parsed = JSON.parse(line) as WatermarkProgress;
          if (parsed.message && typeof parsed.progress === "number") {
            onProgress(parsed);
          }
        } catch {
          stderr.push(Buffer.from(`${line}\n`));
        }
      }
    });
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code && code !== 0) {
        const stderrText = Buffer.concat(stderr).toString("utf8").slice(-3000);
        reject(new Error(`${path.basename(command)} exited with code ${code}.\n${stderrText}`));
        return;
      }

      resolve();
    });
  });
}

function hexToBits(hex: string): number[] {
  return hex.split("").flatMap((char) => {
    const nibble = Number.parseInt(char, 16);
    return [
      (nibble >> 3) & 1,
      (nibble >> 2) & 1,
      (nibble >> 1) & 1,
      nibble & 1,
    ];
  });
}

function bitsToHex(bits: number[]): string {
  let hex = "";

  for (let i = 0; i < bits.length; i += 4) {
    const nibble =
      (bits[i] << 3) |
      (bits[i + 1] << 2) |
      (bits[i + 2] << 1) |
      bits[i + 3];
    hex += nibble.toString(16);
  }

  return hex;
}

function createEmbeddingPlan(width: number, height: number): EmbeddingPoint[] {
  const cols = Math.floor(width / 8);
  const rows = Math.floor(height / 8);
  const points: { x: number; y: number }[] = [];

  for (let y = 3; y < rows - 3; y += 1) {
    for (let x = 3; x < cols - 3; x += 1) {
      points.push({ x: x * 8, y: y * 8 });
    }
  }

  shuffle(points, 0x51f15eed);

  const required = 128 * BIT_REPETITIONS;
  if (points.length < required) {
    throw new Error("Video is too small for robust watermark embedding.");
  }

  return points.slice(0, required).map((point, index) => ({
    ...point,
    bitIndex: index % 128,
  }));
}

function shuffle<T>(items: T[], seed: number) {
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };

  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function embedWatermarkIntoFrame(frame: Buffer, width: number, height: number, watermarkId: string) {
  const bits = hexToBits(watermarkId);
  const plan = createEmbeddingPlan(width, height);

  for (const point of plan) {
    embedBitInBlock(frame, width, point.x, point.y, bits[point.bitIndex]);
  }
}

function accumulateFrameVotes(frame: Buffer, width: number, height: number, votes: number[]) {
  const plan = createEmbeddingPlan(width, height);

  for (const point of plan) {
    votes[point.bitIndex] += readBitVoteFromBlock(frame, width, point.x, point.y);
  }
}

function embedBitInBlock(frame: Buffer, width: number, startX: number, startY: number, bit: number) {
  const originalY = readLuminanceBlock(frame, width, startX, startY);
  const coeffs = dct2d(originalY);
  const aIndex = COEFF_A[1] * 8 + COEFF_A[0];
  const bIndex = COEFF_B[1] * 8 + COEFF_B[0];
  const desiredDiff = bit === 1 ? DCT_STRENGTH : -DCT_STRENGTH;
  const currentDiff = coeffs[aIndex] - coeffs[bIndex];

  if ((bit === 1 && currentDiff < DCT_STRENGTH) || (bit === 0 && currentDiff > -DCT_STRENGTH)) {
    const adjustment = (desiredDiff - currentDiff) / 2;
    coeffs[aIndex] += adjustment;
    coeffs[bIndex] -= adjustment;
  }

  const updatedY = idct2d(coeffs);
  applyLuminanceDelta(frame, width, startX, startY, originalY, updatedY);
}

function readBitVoteFromBlock(frame: Buffer, width: number, startX: number, startY: number): number {
  const yBlock = readLuminanceBlock(frame, width, startX, startY);
  const coeffs = dct2d(yBlock);
  const aIndex = COEFF_A[1] * 8 + COEFF_A[0];
  const bIndex = COEFF_B[1] * 8 + COEFF_B[0];

  return coeffs[aIndex] >= coeffs[bIndex] ? 1 : -1;
}

function readLuminanceBlock(frame: Buffer, width: number, startX: number, startY: number): number[] {
  const block = new Array(64).fill(0) as number[];

  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const pixelIndex = ((startY + y) * width + startX + x) * 3;
      const r = frame[pixelIndex];
      const g = frame[pixelIndex + 1];
      const b = frame[pixelIndex + 2];
      block[y * 8 + x] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
    }
  }

  return block;
}

function applyLuminanceDelta(
  frame: Buffer,
  width: number,
  startX: number,
  startY: number,
  originalY: number[],
  updatedY: number[]
) {
  const deltas = updatedY.map((value, index) => value - originalY[index]);
  const meanDelta = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;

  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const blockIndex = y * 8 + x;
      const delta = clamp(deltas[blockIndex] - meanDelta, -MAX_LUMA_DELTA, MAX_LUMA_DELTA);
      const pixelIndex = ((startY + y) * width + startX + x) * 3;

      frame[pixelIndex] = clampByte(frame[pixelIndex] + delta);
      frame[pixelIndex + 1] = clampByte(frame[pixelIndex + 1] + delta);
      frame[pixelIndex + 2] = clampByte(frame[pixelIndex + 2] + delta);
    }
  }
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dct2d(block: number[]): number[] {
  const out = new Array(64).fill(0) as number[];

  for (let v = 0; v < 8; v += 1) {
    for (let u = 0; u < 8; u += 1) {
      let sum = 0;

      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          sum +=
            block[y * 8 + x] *
            Math.cos(((2 * x + 1) * u * Math.PI) / 16) *
            Math.cos(((2 * y + 1) * v * Math.PI) / 16);
        }
      }

      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      out[v * 8 + u] = 0.25 * cu * cv * sum;
    }
  }

  return out;
}

function idct2d(coeffs: number[]): number[] {
  const out = new Array(64).fill(0) as number[];

  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      let sum = 0;

      for (let v = 0; v < 8; v += 1) {
        for (let u = 0; u < 8; u += 1) {
          const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
          const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
          sum +=
            cu *
            cv *
            coeffs[v * 8 + u] *
            Math.cos(((2 * x + 1) * u * Math.PI) / 16) *
            Math.cos(((2 * y + 1) * v * Math.PI) / 16);
        }
      }

      out[y * 8 + x] = 0.25 * sum;
    }
  }

  return out;
}
