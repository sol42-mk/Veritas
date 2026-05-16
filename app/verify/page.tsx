"use client";

import { useCallback, useEffect, useState } from "react";
import {
  extractWatermark,
  fetchVideoRecord,
  type ExtractedWatermark,
  type VideoRecord,
} from "@/lib/veritas";
import { getSourceProfileForWallet } from "@/lib/sourceRegistry";
import { compareContentFingerprints, parseContentFingerprint, type FingerprintComparison } from "@/lib/contentFingerprint";
import type { ContextFlagReason, StoredContextRecord } from "@/lib/contextTypes";
import { connectPhantom, getConnectedWallet, signWalletAuth } from "@/lib/solana";

type Status = "idle" | "extracting" | "checking" | "verified" | "not-found" | "mismatch" | "error";

interface VerificationResult {
  watermarkId: string;
  record: VideoRecord;
  extraction?: ExtractedWatermark;
  uploadedHash?: string;
  fingerprintCheck?: FingerprintComparison;
  contextRecord?: StoredContextRecord | null;
}

interface AttemptedExtraction {
  watermarkId: string;
  extraction?: ExtractedWatermark;
}

interface ExtensionSourceContext {
  sourceUrl: string;
  pageUrl: string;
  pageHost: string;
}

const STATUS_LABELS: Record<Status, string> = {
  idle: "",
  extracting: "Reading watermark...",
  checking: "Checking Solana devnet...",
  verified: "Record found",
  "not-found": "No record found",
  mismatch: "Fingerprint mismatch",
  error: "Verification failed",
};

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-US");
}

function isValidWatermarkId(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value.trim());
}

async function fetchContextRecord(watermarkId: string): Promise<StoredContextRecord | null> {
  const response = await fetch(`/api/context-records?watermarkId=${encodeURIComponent(watermarkId)}`, {
    cache: "no-store",
  });

  if (!response.ok) return null;

  const body = await response.json().catch(() => null) as { record?: StoredContextRecord | null } | null;
  return body?.record ?? null;
}

export default function VerifyPage() {
  const [file, setFile] = useState<File | null>(null);
  const [manualWatermarkId, setManualWatermarkId] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [attemptedExtraction, setAttemptedExtraction] = useState<AttemptedExtraction | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [flagReason, setFlagReason] = useState<ContextFlagReason>("location");
  const [flagDetails, setFlagDetails] = useState("");
  const [flagMessage, setFlagMessage] = useState("");
  const [citationWallet, setCitationWallet] = useState<string | null>(null);
  const [citationNote, setCitationNote] = useState("");
  const [citationMessage, setCitationMessage] = useState("");
  const [extensionSource, setExtensionSource] = useState<ExtensionSourceContext | null>(null);

  useEffect(() => {
    getConnectedWallet().then(setCitationWallet);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const watermarkId = params.get("watermarkId");
    if (watermarkId && isValidWatermarkId(watermarkId)) {
      setManualWatermarkId(watermarkId);
    }
    const sourceUrl = params.get("sourceUrl") ?? "";
    const pageUrl = params.get("pageUrl") ?? "";
    const pageHost = params.get("pageHost") ?? "";
    if (sourceUrl || pageUrl || pageHost) {
      setExtensionSource({ sourceUrl, pageUrl, pageHost });
    }
  }, []);

  const resetResult = () => {
    setResult(null);
    setAttemptedExtraction(null);
    setError("");
    setFlagMessage("");
    setCitationMessage("");
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
    const contextRecord = await fetchContextRecord(normalizedWatermarkId);
    const fingerprintCheck = extraction
      ? compareContentFingerprints(record.videoHash, extraction.uploadedFingerprint)
      : undefined;

    if (fingerprintCheck && !fingerprintCheck.matches) {
      setResult({ watermarkId: normalizedWatermarkId, record, extraction, uploadedHash, fingerprintCheck, contextRecord });
      setError("");
      setStatus("mismatch");
      return;
    }

    setResult({ watermarkId: normalizedWatermarkId, record, extraction, uploadedHash, fingerprintCheck, contextRecord });
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

  const handleSubmitFlag = async () => {
    if (!result?.contextRecord) return;

    try {
      setFlagMessage("");
      const response = await fetch("/api/context-records/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          watermarkId: result.watermarkId,
          reason: flagReason,
          details: flagDetails,
        }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Could not save flag.");
      }

      setResult({ ...result, contextRecord: body.record });
      setFlagDetails("");
      setFlagMessage("Flag saved.");
    } catch (caughtError: any) {
      setFlagMessage(caughtError.message ?? "Could not save flag.");
    }
  };

  const handleConnectCitationWallet = async () => {
    try {
      setCitationMessage("");
      const connectedWallet = await connectPhantom();
      setCitationWallet(connectedWallet);
    } catch (caughtError: any) {
      setCitationMessage(caughtError.message ?? "Could not connect Phantom.");
    }
  };

  const handleSubmitCitation = async () => {
    if (!result?.contextRecord || !citationWallet) return;

    try {
      setCitationMessage("");
      const auth = await signWalletAuth({
        action: "cite-context",
        wallet: citationWallet,
        watermarkId: result.watermarkId,
        payload: { note: citationNote },
      });
      const response = await fetch("/api/context-records/citations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          watermarkId: result.watermarkId,
          citedBy: citationWallet,
          note: citationNote,
          auth,
        }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Could not save citation.");
      }

      setResult({ ...result, contextRecord: body.record });
      setCitationNote("");
      setCitationMessage("Chain-of-custody citation saved.");
    } catch (caughtError: any) {
      setCitationMessage(caughtError.message ?? "Could not save citation.");
    }
  };

  const isWorking = status === "extracting" || status === "checking";
  const verifiedSourceProfile = result
    ? getSourceProfileForWallet(result.record.registeredBy)
    : null;
  const citationSourceProfile = citationWallet
    ? getSourceProfileForWallet(citationWallet)
    : null;
  const contextEntries = result?.contextRecord
    ? ([
        ["Claimed location", result.contextRecord.claim.location],
        ["Claimed event date", result.contextRecord.claim.eventDate],
        ["Subject", result.contextRecord.claim.subject],
        ["Description", result.contextRecord.claim.description],
        ["Reference URL", result.contextRecord.claim.referenceUrl],
      ] as [string, string | undefined][])
        .filter(([, value]) => Boolean(value))
    : [];
  const extensionNeedsManualUpload = Boolean(
    extensionSource && (
      !extensionSource.sourceUrl ||
      extensionSource.sourceUrl.startsWith("blob:") ||
      extensionSource.pageHost.includes("facebook.com")
    )
  );

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <header className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-wide text-blue-700">Verification</p>
          <h1 className="text-3xl font-semibold text-slate-950">Verify a news video</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">
            Check whether a Veritas watermark maps to a registered Solana devnet provenance record
            and see the source trust tier for the wallet that registered it.
          </p>
        </header>

        {extensionSource && (
          <section className="rounded-lg border border-blue-100 bg-white p-4">
            <p className="text-sm font-semibold text-slate-950">Video selected from browser extension</p>
            <div className="mt-3 space-y-2 text-xs text-slate-600">
              {extensionSource.pageHost && (
                <p>
                  <span className="text-slate-400">Page</span>{" "}
                  <span className="font-mono">{extensionSource.pageHost}</span>
                </p>
              )}
              {extensionSource.sourceUrl && (
                <p className="break-all">
                  <span className="text-slate-400">Detected media URL</span>{" "}
                  <span className="font-mono">{extensionSource.sourceUrl}</span>
                </p>
              )}
            </div>
            {extensionNeedsManualUpload ? (
              <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-900">Manual upload needed</p>
                <p className="mt-1 text-xs leading-5 text-amber-800">
                  This page does not expose a normal downloadable video file to the extension. Use
                  Facebook's own download option or another tool you are allowed to use, then upload
                  the downloaded video file here for verification.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Direct URL import is not enabled yet. Upload the downloaded file here to verify it.
              </p>
            )}
          </section>
        )}

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

        {status === "mismatch" && result && (
          <div className="space-y-3 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
            <p className="text-sm font-medium text-amber-900">
              We couldn't verify the video as matching the registered Veritas record.
            </p>
            <p className="text-xs leading-5 text-amber-800">
              Note: This does not mean that the video is necessarily untruthful. It means the
              watermark ID was found, but the uploaded video did not match the registered content
              fingerprint closely enough.
            </p>
            <div className="rounded-md border border-amber-100 bg-white p-3 text-xs text-slate-600">
              <p className="font-medium text-slate-950">Fingerprint check</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <div>
                  <span className="block text-slate-400">Algorithm</span>
                  <span className="font-mono">{result.fingerprintCheck?.algorithm ?? "unknown"}</span>
                </div>
                <div>
                  <span className="block text-slate-400">Distance</span>
                  <span className="font-mono">
                    {typeof result.fingerprintCheck?.distance === "number"
                      ? result.fingerprintCheck.distance
                      : "not available"}
                  </span>
                </div>
                <div>
                  <span className="block text-slate-400">Threshold</span>
                  <span className="font-mono">{result.fingerprintCheck?.threshold ?? "not available"}</span>
                </div>
              </div>
              <p className="mt-2 text-xs leading-5 text-amber-800">
                {result.fingerprintCheck?.message}
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3">
            <p className="whitespace-pre-wrap text-sm text-red-700">{error}</p>
          </div>
        )}

        {status === "verified" && result && (
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
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Trust tier</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">
                  {verifiedSourceProfile?.trust.tierName}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {verifiedSourceProfile?.trust.description}
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-emerald-100 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Registered</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">
                  {formatTimestamp(result.record.timestamp)}
                </p>
                <p className="mt-1 font-mono text-xs text-slate-500 break-all">
                  {result.record.registeredBy}
                </p>
              </div>

              <div className="rounded-md border border-emerald-100 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Verification meaning</p>
                <p className="mt-2 text-xs leading-5 text-slate-600">
                  This confirms a Veritas record exists for the recovered watermark. It does not
                  independently prove that every claim about the video is true.
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

            <div className="rounded-md border border-emerald-100 bg-white p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Context claims</p>
              {result.contextRecord && contextEntries.length > 0 ? (
                <div className="mt-3 space-y-2 text-xs">
                  {contextEntries.map(([label, value]) => (
                    <div key={label} className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                      <span className="text-slate-400">{label}</span>
                      {label === "Reference URL" && value ? (
                        <a
                          href={value}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all text-blue-700 hover:text-blue-800"
                        >
                          {value}
                        </a>
                      ) : (
                        <span className="break-words text-slate-900">{value}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  No extra context claims were saved for this record.
                </p>
              )}
              {result.contextRecord?.contextHash && (
                <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs">
                  <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                    <span className="text-slate-400">Context hash</span>
                    <span className="break-all font-mono text-slate-900">{result.contextRecord.contextHash}</span>
                  </div>
                  {result.contextRecord.contextMemoSignature && (
                    <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                      <span className="text-slate-400">Solana memo</span>
                      <a
                        href={`https://explorer.solana.com/tx/${result.contextRecord.contextMemoSignature}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all font-mono text-blue-700 hover:text-blue-800"
                      >
                        {result.contextRecord.contextMemoSignature}
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>

            {result.contextRecord && (
              <div className="rounded-md border border-emerald-100 bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Chain of custody</p>
                  <span className="text-xs text-slate-500">
                    {result.contextRecord.citations.length} citation{result.contextRecord.citations.length === 1 ? "" : "s"}
                  </span>
                </div>
                {result.contextRecord.citations.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {result.contextRecord.citations.map((citation) => (
                      <div key={citation.id} className="rounded-md bg-slate-50 p-3 text-xs">
                        <div className="flex flex-wrap gap-2 text-slate-500">
                          <span className="font-medium text-slate-700">{citation.citedBySourceName}</span>
                          <span>{new Date(citation.createdAt).toLocaleString("en-US")}</span>
                        </div>
                        <p className="mt-1 break-all font-mono text-slate-500">{citation.citedBy}</p>
                        {citation.note && <p className="mt-1 text-slate-700">{citation.note}</p>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-3 grid gap-3">
                  {!citationWallet ? (
                    <button
                      onClick={handleConnectCitationWallet}
                      className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      Connect wallet to cite
                    </button>
                  ) : (
                    <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                      <span className="font-medium text-slate-900">
                        {citationSourceProfile?.trust.tierName}
                      </span>
                      <p className="mt-1 break-all font-mono">{citationWallet}</p>
                    </div>
                  )}
                  <textarea
                    value={citationNote}
                    onChange={(event) => setCitationNote(event.target.value)}
                    rows={2}
                    placeholder="Optional citation note from a verified newsroom."
                    className="resize-none rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                  <button
                    onClick={handleSubmitCitation}
                    disabled={!citationWallet || citationSourceProfile?.trust.tier !== 1}
                    className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Add chain-of-custody citation
                  </button>
                  {citationMessage && (
                    <p className="text-xs text-slate-500">{citationMessage}</p>
                  )}
                </div>
              </div>
            )}

            {result.contextRecord && (
              <div className="rounded-md border border-emerald-100 bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Flags</p>
                  <span className="text-xs text-slate-500">
                    {result.contextRecord.flags.length} saved
                  </span>
                </div>
                {result.contextRecord.flags.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {result.contextRecord.flags.map((flag) => (
                      <div key={flag.id} className="rounded-md bg-slate-50 p-3 text-xs">
                        <div className="flex flex-wrap gap-2 text-slate-500">
                          <span className="font-medium text-slate-700">{flag.reason}</span>
                          <span>{new Date(flag.createdAt).toLocaleString("en-US")}</span>
                        </div>
                        <p className="mt-1 text-slate-700">{flag.details}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-3 grid gap-3">
                  <select
                    value={flagReason}
                    onChange={(event) => setFlagReason(event.target.value as ContextFlagReason)}
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="location">Claimed location does not match</option>
                    <option value="date">Claimed date does not match</option>
                    <option value="subject">Claimed subject does not match</option>
                    <option value="description">Description is misleading</option>
                    <option value="other">Other issue</option>
                  </select>
                  <textarea
                    value={flagDetails}
                    onChange={(event) => setFlagDetails(event.target.value)}
                    rows={3}
                    placeholder="Describe the issue with the claimed context."
                    className="resize-none rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                  <button
                    onClick={handleSubmitFlag}
                    disabled={!flagDetails.trim()}
                    className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Submit flag
                  </button>
                  {flagMessage && (
                    <p className="text-xs text-slate-500">{flagMessage}</p>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2 rounded-md border border-emerald-100 bg-white p-3 text-xs">
              {([
                ["Watermark ID", result.watermarkId],
                ["Registered content fingerprint", result.record.videoHash],
                ["Fingerprint type", parseContentFingerprint(result.record.videoHash).algorithm],
                ...(result.extraction?.uploadedFingerprint
                  ? [["Uploaded content fingerprint", result.extraction.uploadedFingerprint] as [string, string]]
                  : []),
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
