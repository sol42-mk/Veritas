"use client";

// Journalist upload page. Phantom signs and pays for the register transaction.

import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { embedWatermark, type WatermarkJobProgress } from "@/lib/veritas";
import { getSourceProfileForWallet } from "@/lib/sourceRegistry";
import {
  buildRegisterTx,
  connectPhantom,
  getConnectedWallet,
  signAndSendTx,
} from "@/lib/solana";

type Step = "idle" | "watermarking" | "building" | "signing" | "confirming" | "done" | "error";

interface Result {
  watermarkId: string;
  videoHash: string;
  signature: string;
  explorerUrl: string;
  downloadUrl: string;
  registeredAt: string;
}

const STEP_LABELS: Record<Step, string> = {
  idle: "",
  watermarking: "Embedding provenance watermark...",
  building: "Preparing Solana transaction...",
  signing: "Approve the transaction in Phantom...",
  confirming: "Confirming on Solana devnet...",
  done: "Registration complete",
  error: "Error",
};

const PROGRESS_STEPS: Step[] = ["watermarking", "building", "signing", "confirming"];

export default function RegisterPage() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [watermarkProgress, setWatermarkProgress] = useState<WatermarkJobProgress | null>(null);
  const [watermarkStartedAt, setWatermarkStartedAt] = useState<number | null>(null);
  const [watermarkElapsedMs, setWatermarkElapsedMs] = useState(0);

  const sourceProfile = useMemo(
    () => (wallet ? getSourceProfileForWallet(wallet) : null),
    [wallet]
  );

  useEffect(() => {
    getConnectedWallet().then(setWallet);
  }, []);

  useEffect(() => {
    if (step !== "watermarking" || !watermarkStartedAt) return;

    const timer = window.setInterval(() => {
      setWatermarkElapsedMs(Date.now() - watermarkStartedAt);
    }, 500);

    return () => window.clearInterval(timer);
  }, [step, watermarkStartedAt]);

  const handleConnect = async () => {
    setError("");
    try {
      const pubkey = await connectPhantom();
      setWallet(pubkey);
    } catch (e: any) {
      setError(e.message ?? "Could not connect Phantom.");
    }
  };

  const handleFile = (selectedFile: File) => {
    if (!selectedFile.type.startsWith("video/")) {
      setError("Please upload a video file.");
      return;
    }

    setFile(selectedFile);
    setError("");
    setResult(null);
    setWatermarkProgress(null);
    setWatermarkElapsedMs(0);
    setWatermarkStartedAt(null);
    setStep("idle");
  };

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile) handleFile(droppedFile);
  }, []);

  const handleRegister = async () => {
    if (!file || !wallet || !sourceProfile) return;
    setError("");
    setResult(null);

    try {
      setStep("watermarking");
      setWatermarkStartedAt(Date.now());
      setWatermarkElapsedMs(0);
      setWatermarkProgress({
        message: "Starting metadata and DCT watermarking...",
        progress: 0,
        elapsedMs: 0,
      });
      const { watermarkId, videoHash, watermarkedBlob } = await embedWatermark(file, (progress) => {
        setWatermarkProgress(progress);
      });

      setStep("building");
      const tx = await buildRegisterTx(
        new PublicKey(wallet),
        watermarkId,
        videoHash,
        sourceProfile.sourceId,
        sourceProfile.sourceName
      );

      setStep("signing");
      const signature = await signAndSendTx(tx);

      setStep("confirming");

      setResult({
        watermarkId,
        videoHash,
        signature,
        explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
        downloadUrl: URL.createObjectURL(watermarkedBlob),
        registeredAt: new Date().toLocaleString("en-US"),
      });
      setWatermarkProgress(null);
      setWatermarkStartedAt(null);
      setStep("done");
    } catch (e: any) {
      if (e.message?.toLowerCase().includes("rejected") || e.message?.toLowerCase().includes("cancelled")) {
        setStep("idle");
        return;
      }

      setError(e.message ?? "Something went wrong.");
      setStep("error");
    }
  };

  const isProcessing = PROGRESS_STEPS.includes(step);
  const visibleWatermarkProgress = watermarkProgress
    ? Math.round(Math.max(0, Math.min(1, watermarkProgress.progress)) * 100)
    : 0;
  const visibleElapsedSeconds = Math.floor(
    Math.max(watermarkProgress?.elapsedMs ?? 0, watermarkElapsedMs) / 1000
  );
  const visibleFrameText =
    watermarkProgress?.currentFrame && watermarkProgress.totalFrames
      ? `Frame ${Math.min(watermarkProgress.currentFrame, watermarkProgress.totalFrames)} of ${watermarkProgress.totalFrames}`
      : null;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-wide text-blue-700">Source registration</p>
          <h1 className="text-3xl font-semibold text-slate-950">Register a news video</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">
            Upload the original footage, bind it to your assigned source identity, and publish a
            provenance record on Solana devnet.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-[1fr_1.1fr]">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-950">Wallet</h2>
            {!wallet ? (
              <div className="mt-3 space-y-3">
                <button
                  onClick={handleConnect}
                  className="w-full rounded-md bg-slate-950 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                >
                  Connect Wallet
                </button>
                <p className="text-xs leading-5 text-slate-500">
                  Use Phantom on devnet. The connected wallet becomes the on-chain registrant.
                </p>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="text-xs font-medium text-emerald-700">Connected on devnet</span>
                </div>
                <p className="break-all font-mono text-xs text-slate-600">{wallet}</p>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-950">Assigned source</h2>
            {sourceProfile ? (
              <div className="mt-3 space-y-2">
                <p className="text-lg font-semibold text-slate-950">{sourceProfile.sourceName}</p>
                <p className="text-sm text-slate-600">{sourceProfile.label}</p>
                <p className="font-mono text-xs text-slate-400">source_id: {sourceProfile.sourceId}</p>
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                Connect a wallet to load the source identity assigned by Veritas.
              </p>
            )}
          </div>
        </section>

        <section
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => document.getElementById("file-input")?.click()}
          className={`cursor-pointer rounded-lg border-2 border-dashed bg-white transition-colors ${
            dragOver ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"
          } ${file ? "p-5" : "px-6 py-14"}`}
        >
          <input
            id="file-input"
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
                  setResult(null);
                  setWatermarkProgress(null);
                  setWatermarkStartedAt(null);
                  setWatermarkElapsedMs(0);
                  setStep("idle");
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
                Drop a video here or <span className="text-blue-700">browse files</span>
              </p>
              <p className="mt-1 text-xs text-slate-400">MP4, MOV, AVI, or other browser-supported video files</p>
            </div>
          )}
        </section>

        {file && !result && (
          <button
            onClick={handleRegister}
            disabled={isProcessing || !wallet}
            className="w-full rounded-md bg-blue-700 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isProcessing ? STEP_LABELS[step] : wallet ? "Register video" : "Connect wallet to register"}
          </button>
        )}

        {isProcessing && (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
            {PROGRESS_STEPS.map((progressStep) => {
              const idx = PROGRESS_STEPS.indexOf(progressStep);
              const cur = PROGRESS_STEPS.indexOf(step);
              const isDone = idx < cur;
              const isActive = idx === cur;

              return (
                <div key={progressStep} className="flex items-center gap-3">
                  <div
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${
                      isDone ? "bg-emerald-100" : isActive ? "bg-blue-100" : "bg-slate-100"
                    }`}
                  >
                    {isDone ? (
                      <svg className="h-3 w-3 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : isActive ? (
                      <div className="h-2 w-2 animate-pulse rounded-full bg-blue-700" />
                    ) : (
                      <div className="h-2 w-2 rounded-full bg-slate-300" />
                    )}
                  </div>
                  <span
                    className={`text-xs ${
                      isActive ? "font-medium text-slate-950" : isDone ? "text-emerald-700" : "text-slate-400"
                    }`}
                  >
                    {STEP_LABELS[progressStep]}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {step === "watermarking" && watermarkProgress && (
          <div className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-950">{watermarkProgress.message}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Elapsed {visibleElapsedSeconds}s{visibleFrameText ? ` · ${visibleFrameText}` : ""}.
                  Backend video processing can take a while for longer clips.
                </p>
              </div>
              <span className="font-mono text-sm font-semibold text-blue-700">
                {visibleWatermarkProgress}%
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-700 transition-all duration-300"
                style={{ width: `${visibleWatermarkProgress}%` }}
              />
            </div>
          </div>
        )}

        {step === "signing" && (
          <div className="flex items-start gap-3 rounded-lg border border-violet-100 bg-violet-50 px-4 py-3">
            <div className="mt-1.5 h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-violet-500" />
            <p className="text-xs leading-5 text-violet-800">
              Phantom should be open now. Review the devnet transaction and approve it to register the video.
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {result && (
          <div className="space-y-4 rounded-lg border border-emerald-100 bg-emerald-50 p-5">
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5 flex-shrink-0 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-medium text-emerald-900">Registered on Solana devnet</span>
            </div>
            <div className="space-y-2 rounded-md border border-emerald-100 bg-white p-3 text-xs">
              {([
                ["Source", sourceProfile?.sourceName ?? ""],
                ["Watermark ID", result.watermarkId],
                ["SHA-256", result.videoHash.slice(0, 32) + "..."],
                ["Registered", result.registeredAt],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="flex gap-2">
                  <span className="w-24 flex-shrink-0 text-slate-400">{label}</span>
                  <span className="break-all font-mono text-slate-900">{value}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <a
                href={result.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 rounded-md border border-emerald-200 bg-white py-2 text-center text-xs font-medium text-emerald-900 transition-colors hover:bg-emerald-50"
              >
                View in Solana Explorer
              </a>
              <a
                href={result.downloadUrl}
                download={`verified_${file?.name}`}
                className="flex-1 rounded-md bg-emerald-700 py-2 text-center text-xs font-medium text-white transition-colors hover:bg-emerald-800"
              >
                Download watermarked video
              </a>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
