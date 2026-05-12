"use client";

import { useCallback, useState } from "react";
import {
  extractWatermark,
  fetchVideoRecord,
  type ExtractedWatermark,
  type VideoRecord,
} from "@/lib/veritas";

type Status = "idle" | "extracting" | "checking" | "verified" | "not-found" | "error";

interface VerificationResult {
  watermarkId: string;
  record: VideoRecord;
  extraction?: ExtractedWatermark;
  uploadedHash?: string;
}

interface AttemptedExtraction {
  watermarkId: string;
  extraction?: ExtractedWatermark;
}

const STATUS_LABELS: Record<Status, string> = {
  idle: "",
  extracting: "Reading watermark...",
  checking: "Checking Solana devnet...",
  verified: "Record found",
  "not-found": "No record found",
  error: "Verification failed",
};

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-US");
}

function isValidWatermarkId(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value.trim());
}

export default function VerifyPage() {
  const [file, setFile] = useState<File | null>(null);
  const [manualWatermarkId, setManualWatermarkId] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [attemptedExtraction, setAttemptedExtraction] = useState<AttemptedExtraction | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const resetResult = () => {
    setResult(null);
    setAttemptedExtraction(null);
    setError("");
    setStatus("idle");
  };

  const handleFile = (selectedFile: File) => {
    if (!selectedFile.type.startsWith("video/")) {
      setError("Please upload a video file.");
      setStatus("error");
      return;
    }

    setFile(selectedFile);
    resetResult();
  };

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile) handleFile(droppedFile);
  }, []);

  const verifyWatermark = async (
    watermarkId: string,
    extraction?: ExtractedWatermark
  ) => {
    const normalizedWatermarkId = watermarkId.trim().toLowerCase();

    if (!isValidWatermarkId(normalizedWatermarkId)) {
      setError("Watermark ID must be 32 hexadecimal characters.");
      setStatus("error");
      return;
    }

    setStatus("checking");
    setAttemptedExtraction({ watermarkId: normalizedWatermarkId, extraction });
    const record = await fetchVideoRecord(normalizedWatermarkId);

    if (!record) {
      setResult(null);
      setError("");
      setStatus("not-found");
      return;
    }

    const uploadedHash = extraction?.uploadedHash;
    setResult({ watermarkId: normalizedWatermarkId, record, extraction, uploadedHash });
    setError("");
    setStatus("verified");
  };

  const handleVerifyFile = async () => {
    if (!file) return;

    try {
      setError("");
      setResult(null);
      setStatus("extracting");

      const extracted = await extractWatermark(file);

      if (!extracted) {
        setStatus("not-found");
        return;
      }

      if (extracted.trusted === false) {
        setAttemptedExtraction({ watermarkId: extracted.watermarkId, extraction: extracted });
        setStatus("not-found");
        return;
      }

      await verifyWatermark(extracted.watermarkId, extracted);
    } catch (caughtError: any) {
      setError(caughtError.message ?? "Could not verify this video.");
      setStatus("error");
    }
  };

  const handleVerifyManual = async () => {
    try {
      setError("");
      setResult(null);
      await verifyWatermark(manualWatermarkId);
    } catch (caughtError: any) {
      setError(caughtError.message ?? "Could not verify this watermark ID.");
      setStatus("error");
    }
  };

  const isWorking = status === "extracting" || status === "checking";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <header className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-wide text-blue-700">Verification</p>
          <h1 className="text-3xl font-semibold text-slate-950">Verify a news video</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">
            Check whether a Veritas watermark maps to a registered Solana devnet provenance record.
          </p>
        </header>

        <section
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => document.getElementById("verify-file-input")?.click()}
          className={`cursor-pointer rounded-lg border-2 border-dashed bg-white transition-colors ${
            dragOver ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"
          } ${file ? "p-5" : "px-6 py-14"}`}
        >
          <input
            id="verify-file-input"
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(event) => {
              const selectedFile = event.target.files?.[0];
              if (selectedFile) handleFile(selectedFile);
            }}
          />

          {file ? (
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-blue-50">
                <svg className="h-5 w-5 text-blue-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
                  />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-950">{file.name}</p>
                <p className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  setFile(null);
                  resetResult();
                }}
                className="ml-auto text-sm font-medium text-slate-500 hover:text-slate-800"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="text-center">
              <svg className="mx-auto mb-3 h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <p className="text-sm text-slate-600">
                Drop a watermarked video here or <span className="text-blue-700">browse files</span>
              </p>
              <p className="mt-1 text-xs text-slate-400">MP4 files registered through Veritas work best</p>
            </div>
          )}
        </section>

        {file && (
          <button
            onClick={handleVerifyFile}
            disabled={isWorking}
            className="w-full rounded-md bg-blue-700 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isWorking ? STATUS_LABELS[status] : "Verify video"}
          </button>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <label htmlFor="manual-watermark-id" className="text-sm font-semibold text-slate-950">
            Watermark ID
          </label>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input
              id="manual-watermark-id"
              value={manualWatermarkId}
              onChange={(event) => setManualWatermarkId(event.target.value)}
              placeholder="32-character watermark ID"
              className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-2 font-mono text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <button
              onClick={handleVerifyManual}
              disabled={isWorking || !manualWatermarkId.trim()}
              className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Check ID
            </button>
          </div>
        </section>

        {status === "not-found" && (
          <div className="space-y-3 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
            <p className="text-sm font-medium text-amber-900">
              We couldn't verify the video as being from a trusted source.
            </p>
            <p className="text-xs leading-5 text-amber-800">
              Note: This does not mean that the video is necessarily untruthful. It only means Veritas cannot
              confirm that it came from one of our trusted sources.
            </p>
            {attemptedExtraction ? (
              <div className="rounded-md border border-amber-100 bg-white p-3 text-xs text-slate-600">
                <p className="font-medium text-slate-950">Watermark extraction attempt</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-4">
                  <div>
                    <span className="block text-slate-400">Method</span>
                    <span className="font-mono">{attemptedExtraction.extraction?.method ?? "manual"}</span>
                  </div>
                  <div>
                    <span className="block text-slate-400">Recovered ID</span>
                    <span className="break-all font-mono">{attemptedExtraction.watermarkId}</span>
                  </div>
                  <div>
                    <span className="block text-slate-400">Confidence</span>
                    <span className="font-mono">
                      {typeof attemptedExtraction.extraction?.confidence === "number"
                        ? `${(attemptedExtraction.extraction.confidence * 100).toFixed(1)}%`
                        : "not available"}
                    </span>
                  </div>
                  <div>
                    <span className="block text-slate-400">Frames</span>
                    <span className="font-mono">
                      {attemptedExtraction.extraction?.framesAnalyzed ?? "not sampled"}
                    </span>
                  </div>
                </div>
                {attemptedExtraction.extraction?.rejectionReason && (
                  <p className="mt-2 text-xs leading-5 text-amber-800">
                    {attemptedExtraction.extraction.rejectionReason}
                  </p>
                )}
                {attemptedExtraction.extraction?.candidatesTested && (
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Tested {attemptedExtraction.extraction.candidatesTested} DCT extraction candidates
                    {attemptedExtraction.extraction.extractionWidth
                      ? `; best candidate used ${attemptedExtraction.extraction.extractionWidth}x${attemptedExtraction.extraction.extractionHeight}.`
                      : "."}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-amber-800">
                No metadata or DCT watermark ID could be extracted from this file.
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3">
            <p className="whitespace-pre-wrap text-sm text-red-700">{error}</p>
          </div>
        )}

        {result && (
          <section className="space-y-4 rounded-lg border border-emerald-100 bg-emerald-50 p-5">
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5 flex-shrink-0 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="text-sm font-medium text-emerald-900">Verified Veritas record</span>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-emerald-100 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Source</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{result.record.sourceName}</p>
                <p className="mt-1 font-mono text-xs text-slate-500">source_id: {result.record.sourceId}</p>
              </div>

              <div className="rounded-md border border-emerald-100 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Registered</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">
                  {formatTimestamp(result.record.timestamp)}
                </p>
                <p className="mt-1 font-mono text-xs text-slate-500 break-all">
                  {result.record.registeredBy}
                </p>
              </div>
            </div>

            {result.extraction && (
              <div className="rounded-md border border-emerald-100 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Watermark detection</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">
                  {result.extraction.method === "metadata"
                    ? "MP4 metadata watermark"
                    : "DCT spread-spectrum visual watermark"}
                </p>
                <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                  <div>
                    <span className="block text-slate-400">Method</span>
                    <span className="font-mono">{result.extraction.method}</span>
                  </div>
                  <div>
                    <span className="block text-slate-400">Confidence</span>
                    <span className="font-mono">
                      {typeof result.extraction.confidence === "number"
                        ? `${(result.extraction.confidence * 100).toFixed(1)}%`
                        : "not needed"}
                    </span>
                  </div>
                  <div>
                    <span className="block text-slate-400">Frames</span>
                    <span className="font-mono">
                      {result.extraction.framesAnalyzed ?? "not sampled"}
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  {result.extraction.method === "metadata"
                    ? "Metadata was found, so DCT fallback was not needed for this file."
                    : "Metadata was missing or unreadable, so verification used the visual DCT watermark."}
                </p>
              </div>
            )}

            <div className="space-y-2 rounded-md border border-emerald-100 bg-white p-3 text-xs">
              {([
                ["Watermark ID", result.watermarkId],
                ["Registered original SHA-256", result.record.videoHash],
                ...(result.uploadedHash ? [["Uploaded file SHA-256", result.uploadedHash] as [string, string]] : []),
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="flex gap-2">
                  <span className="w-40 flex-shrink-0 text-slate-400">{label}</span>
                  <span className="break-all font-mono text-slate-900">{value}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
