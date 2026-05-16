import { spawn } from "child_process";
import path from "path";
import { formatVideoHashForStorage } from "@/lib/contentFingerprint";

const DEFAULT_VIDEOHASH_WORKER_PATH = path.join(
  process.cwd(),
  "workers",
  "videohash",
  "veritas_videohash.py",
);

interface VideoHashWorkerResult {
  hashHex?: string;
  error?: string;
}

export interface ServerVideoHashResult {
  hashHex: string;
  storageValue: string;
}

export async function computeServerVideoHash(
  inputPath: string,
): Promise<ServerVideoHashResult> {
  const python = process.env.VERITAS_VIDEOHASH_PYTHON || "python3";
  const workerPath = process.env.VERITAS_VIDEOHASH_WORKER || DEFAULT_VIDEOHASH_WORKER_PATH;
  const result = await runVideoHashWorker(python, [
    workerPath,
    "--input",
    inputPath,
  ]);

  if (!result.hashHex) {
    throw new Error(result.error ?? "VideoHash worker did not return a hash.");
  }

  return {
    hashHex: result.hashHex,
    storageValue: formatVideoHashForStorage(result.hashHex),
  };
}

async function runVideoHashWorker(
  command: string,
  args: string[],
): Promise<VideoHashWorkerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      const out = Buffer.concat(stdout).toString("utf8").trim();
      const err = Buffer.concat(stderr).toString("utf8").trim();

      if (code !== 0) {
        const parsedError = parseJson<VideoHashWorkerResult>(err);
        reject(new Error(parsedError?.error ?? err.split("\n").at(-1) ?? "VideoHash worker failed."));
        return;
      }

      const parsed = parseJson<VideoHashWorkerResult>(out);
      if (!parsed) {
        reject(new Error("VideoHash worker returned invalid JSON."));
        return;
      }

      resolve(parsed);
    });
  });
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
