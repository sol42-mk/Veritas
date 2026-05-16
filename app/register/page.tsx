"use client";

// Journalist upload page. Phantom signs and pays for the register transaction.

import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { embedWatermark, type WatermarkJobProgress } from "@/lib/veritas";
import { getSourceProfileForWallet } from "@/lib/sourceRegistry";
import type { ContextClaim } from "@/lib/contextTypes";
import { createBrowserContextHash } from "@/lib/contextCommitment";
import {
 buildRegisterTx,
 connectPhantom,
 getConnectedWallet,
 sendContextMemo,
 signWalletAuth,
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
 contextHash?: string;
 contextMemoSignature?: string;
 contextWarning?: string;
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
 const [contextClaim, setContextClaim] = useState<ContextClaim>({
 location: "",
 eventDate: "",
 subject: "",
 description: "",
 referenceUrl: "",
 });

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
 let contextWarning: string | undefined;
 let savedContextHash: string | undefined;
 let savedContextMemoSignature: string | undefined;

 try {
 const contextPayload = {
 sourceId: sourceProfile.sourceId,
 sourceName: sourceProfile.sourceName,
 transactionSignature: signature,
 contentFingerprint: videoHash,
 originalFileName: file.name,
 claim: contextClaim,
 };
 const contextHash = await createBrowserContextHash({
 watermarkId,
 ...contextPayload,
 registeredBy: wallet,
 });
 const contextMemoSignature = await sendContextMemo(
 new PublicKey(wallet),
 watermarkId,
 contextHash,
 );
 savedContextHash = contextHash;
 savedContextMemoSignature = contextMemoSignature;
 const auth = await signWalletAuth({
 action: "save-context",
 wallet,
 watermarkId,
 payload: {
 ...contextPayload,
 contextHash,
 contextMemoSignature,
 },
 });
 const contextResponse = await fetch("/api/context-records", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 watermarkId,
 sourceId: contextPayload.sourceId,
 sourceName: contextPayload.sourceName,
 registeredBy: wallet,
 transactionSignature: contextPayload.transactionSignature,
 contentFingerprint: contextPayload.contentFingerprint,
 contextHash,
 contextMemoSignature,
 originalFileName: contextPayload.originalFileName,
 claim: contextPayload.claim,
 auth,
 }),
 });

 if (!contextResponse.ok) {
 const body = await contextResponse.json().catch(() => null);
 contextWarning = body?.error ?? "Context record could not be saved.";
 }
 } catch (caughtError: any) {
 contextWarning = caughtError.message ?? "Context record could not be saved.";
 }

 setResult({
 watermarkId,
 videoHash,
 signature,
 explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
 downloadUrl: URL.createObjectURL(watermarkedBlob),
 registeredAt: new Date().toLocaleString("en-US"),
 contextHash: savedContextHash,
 contextMemoSignature: savedContextMemoSignature,
 contextWarning,
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

 const updateContextClaim = (field: keyof ContextClaim, value: string) => {
 setContextClaim((current) => ({ ...current, [field]: value }));
 };

 return (
 <main className="min-h-screen bg-transparent px-4 py-12 pt-20">
 <div className="mx-auto w-full max-w-3xl space-y-6 relative z-10">
 <header className="space-y-2">
 <p className="inline-block text-xs font-bold uppercase tracking-widest text-white bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl px-3 py-1.5 rounded-full border border-emerald-400/20 ">Source registration</p>
 <h1 className="text-4xl font-bold text-white pt-2">Register a news video</h1>
 <p className="max-w-2xl text-sm leading-6 text-slate-300">
 Upload the original footage, bind it to your wallet-based source identity, and publish
 a provenance record on Solana devnet.
 </p>
 </header>

 <section className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
 <div className="panel rounded-lg p-5">
 <h2 className="text-sm font-bold text-white">Wallet</h2>
 {!wallet ? (
 <div className="mt-4 space-y-3">
 <button
 onClick={handleConnect}
 className="w-full rounded-lg bg-white hover:bg-neutral-200 px-4 py-3.5 text-sm font-bold text-black transition-all "
 >
 Connect Wallet
 </button>
 <p className="text-xs leading-5 text-slate-300">
 Use Phantom on devnet. The connected wallet becomes the on-chain registrant.
 </p>
 </div>
 ) : (
 <div className="mt-4 space-y-3">
 <div className="flex items-center gap-2">
 <div className="h-2 w-2 rounded-full bg-white animate-pulse " />
 <span className="text-xs font-bold text-white">Connected on devnet</span>
 </div>
 <p className="break-all font-mono text-xs text-slate-300 bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl/50 p-2 rounded-lg border border-white/10">{wallet}</p>
 </div>
 )}
 </div>

 <div className="panel rounded-lg p-5">
 <h2 className="text-sm font-bold text-white">Source identity</h2>
 {sourceProfile ? (
 <div className="mt-4 space-y-3">
 <div className="flex flex-wrap items-center gap-2">
 <p className="text-xl font-bold text-white">{sourceProfile.sourceName}</p>
 <span
 className={`rounded-full px-3 py-1 text-xs font-bold border ${
 sourceProfile.trust.verifiedByVeritas
 ? "bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl text-white border-white/10 "
 : "bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl text-white border-white/10 "
 }`}
 >
 {sourceProfile.trust.tierName}
 </span>
 </div>
 <p className="text-sm text-slate-300">{sourceProfile.label}</p>
 <p className="text-xs leading-5 text-slate-300">{sourceProfile.trust.description}</p>
 <p className="font-mono text-xs text-slate-400">source_id: {sourceProfile.sourceId}</p>
 </div>
 ) : (
 <p className="mt-4 text-sm leading-6 text-slate-300">
 Connect a wallet to load its source identity. Unknown wallets register as Tier 2
 independent sources.
 </p>
 )}
 </div>
 </section>

 <section className="panel rounded-lg p-5">
 <h2 className="text-sm font-bold text-white">Context claims</h2>
 <div className="mt-4 grid gap-4 md:grid-cols-2">
 <label className="space-y-1.5">
 <span className="text-xs font-semibold text-slate-300">Claimed location</span>
 <input
 value={contextClaim.location ?? ""}
 onChange={(event) => updateContextClaim("location", event.target.value)}
 placeholder="City, region, or venue"
 className="w-full rounded-lg icy-input px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-white/10 focus:ring-2 focus:ring-emerald-500/20 focus:bg-white/5 focus:border-white/60"
 />
 </label>
 <label className="space-y-1.5">
 <span className="text-xs font-semibold text-slate-300">Claimed event date</span>
 <input
 type="date"
 value={contextClaim.eventDate ?? ""}
 onChange={(event) => updateContextClaim("eventDate", event.target.value)}
 className="w-full rounded-lg icy-input px-4 py-2.5 text-sm text-white outline-none transition-all focus:border-white/10 focus:ring-2 focus:ring-emerald-500/20 focus:bg-white/5 focus:border-white/60"
 style={{ colorScheme: "dark" }}
 />
 </label>
 <label className="space-y-1.5 md:col-span-2">
 <span className="text-xs font-semibold text-slate-300">Who or what is this about?</span>
 <input
 value={contextClaim.subject ?? ""}
 onChange={(event) => updateContextClaim("subject", event.target.value)}
 placeholder="Person, organization, protest, incident, briefing..."
 className="w-full rounded-lg icy-input px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-white/10 focus:ring-2 focus:ring-emerald-500/20 focus:bg-white/5 focus:border-white/60"
 />
 </label>
 <label className="space-y-1.5 md:col-span-2">
 <span className="text-xs font-semibold text-slate-300">Short description</span>
 <textarea
 value={contextClaim.description ?? ""}
 onChange={(event) => updateContextClaim("description", event.target.value)}
 rows={3}
 placeholder="Briefly describe what the clip is claimed to show."
 className="w-full resize-none rounded-lg icy-input px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-white/10 focus:ring-2 focus:ring-emerald-500/20 focus:bg-white/5 focus:border-white/60"
 />
 </label>
 <label className="space-y-1.5 md:col-span-2">
 <span className="text-xs font-semibold text-slate-300">Reference URL</span>
 <input
 value={contextClaim.referenceUrl ?? ""}
 onChange={(event) => updateContextClaim("referenceUrl", event.target.value)}
 placeholder="https://..."
 className="w-full rounded-lg icy-input px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-white/10 focus:ring-2 focus:ring-emerald-500/20 focus:bg-white/5 focus:border-white/60"
 />
 </label>
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
 className={`cursor-pointer rounded-lg border-2 border-dashed transition-all duration-300 backdrop-blur-md ${
 dragOver ? "border-white bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl shadow-neon" : "border-white/10 bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl/50 hover:border-white/10 hover:bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl"
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
 <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white/5 border border-white/10">
 <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path
 strokeLinecap="round"
 strokeLinejoin="round"
 strokeWidth={2}
 d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
 />
 </svg>
 </div>
 <div className="min-w-0">
 <p className="truncate text-sm font-bold text-white">{file.name}</p>
 <p className="text-xs text-slate-300">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
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
 className="ml-auto text-sm font-medium text-white hover:text-white"
 >
 Change
 </button>
 </div>
 ) : (
 <div className="text-center">
 <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full icy-input shadow-lg">
 <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path
 strokeLinecap="round"
 strokeLinejoin="round"
 strokeWidth={2}
 d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
 />
 </svg>
 </div>
 <p className="text-sm font-medium text-slate-300">
 Drop a video here or <span className="text-white font-bold hover:underline">browse files</span>
 </p>
 <p className="mt-2 text-xs text-slate-400">MP4, MOV, AVI, or other browser-supported video files</p>
 </div>
 )}
 </section>

 {file && !result && (
 <button
 onClick={handleRegister}
 disabled={isProcessing || !wallet}
 className="w-full rounded-lg bg-white px-4 py-4 text-sm font-bold text-black transition-all disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:hover:shadow-none"
 >
 {isProcessing ? STEP_LABELS[step] : wallet ? "Register video" : "Connect wallet to register"}
 </button>
 )}

 {isProcessing && (
 <div className="space-y-3 panel rounded-lg p-5">
 {PROGRESS_STEPS.map((progressStep) => {
 const idx = PROGRESS_STEPS.indexOf(progressStep);
 const cur = PROGRESS_STEPS.indexOf(step);
 const isDone = idx < cur;
 const isActive = idx === cur;

 return (
 <div key={progressStep} className="flex items-center gap-4">
 <div
 className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-colors ${
 isDone ? "bg-white/5 border border-white/10" : isActive ? "bg-white/5 border border-white/10 " : "icy-input"
 }`}
 >
 {isDone ? (
 <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
 </svg>
 ) : isActive ? (
 <div className="h-2 w-2 animate-pulse rounded-full bg-white" />
 ) : (
 <div className="h-2 w-2 rounded-full bg-slate-600" />
 )}
 </div>
 <span
 className={`text-sm ${
 isActive ? "font-bold text-white" : isDone ? "font-medium text-white" : "text-slate-400"
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
 <div className="rounded-lg border border-white/10 bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl p-5 backdrop-blur-md">
 <div className="flex items-center justify-between gap-4">
 <div>
 <p className="text-sm font-bold text-white">{watermarkProgress.message}</p>
 <p className="mt-1.5 text-xs text-white">
 Elapsed {visibleElapsedSeconds}s{visibleFrameText ? ` · ${visibleFrameText}` : ""}.
 Backend video processing can take a while for longer clips.
 </p>
 </div>
 <span className="font-mono text-lg font-bold text-white ">
 {visibleWatermarkProgress}%
 </span>
 </div>
 <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-900/50 border border-white/10">
 <div
 className="h-full rounded-full bg-white transition-all duration-300 "
 style={{ width: `${visibleWatermarkProgress}%` }}
 />
 </div>
 </div>
 )}

 {step === "signing" && (
 <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl px-5 py-4 backdrop-blur-md ">
 <div className="mt-1 h-2.5 w-2.5 flex-shrink-0 animate-pulse rounded-full bg-white " />
 <p className="text-sm leading-relaxed text-white">
 Phantom should be open now. Review the devnet transaction and approve it to register the video.
 </p>
 </div>
 )}

 {error && (
 <div className="rounded-lg border border-white/10 bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl px-5 py-4 backdrop-blur-md">
 <p className="text-sm font-medium text-white">{error}</p>
 </div>
 )}

 {result && (
 <div className="space-y-5 rounded-lg border border-white/10 bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl p-6 backdrop-blur-md relative overflow-hidden">
 
 <div className="flex items-center gap-3 relative z-10">
 <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 border border-white/10">
 <svg className="h-4 w-4 flex-shrink-0 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
 </svg>
 </div>
 <span className="text-base font-bold text-white ">Registered on Solana devnet</span>
 </div>
 
 <div className="space-y-3 rounded-lg border border-white/10 bg-transparent/20 p-4 text-xs relative z-10">
 {([
 ["Source", sourceProfile?.sourceName ?? ""],
 ["Trust tier", sourceProfile?.trust.tierName ?? ""],
 ["Watermark ID", result.watermarkId],
 ["Stored fingerprint", result.videoHash],
 ...(result.contextHash ? [["Context hash", result.contextHash] as [string, string]] : []),
 ...(result.contextMemoSignature ? [["Context memo", result.contextMemoSignature] as [string, string]] : []),
 ["Registered", result.registeredAt],
 ] as [string, string][]).map(([label, value]) => (
 <div key={label} className="flex gap-3 items-start sm:items-center">
 <span className="w-28 flex-shrink-0 font-medium text-slate-300">{label}</span>
 <span className="break-all font-mono text-white bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl/50 px-2 py-1 rounded-lg">{value}</span>
 </div>
 ))}
 </div>

 {result.contextWarning ? (
 <div className="rounded-lg border border-white/10 bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl px-4 py-3 text-sm text-white relative z-10">
 Solana registration succeeded, but the context record was not saved: {result.contextWarning}
 </div>
 ) : (
 <div className="rounded-lg border border-white/10 bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl px-4 py-3 text-sm text-white relative z-10">
 Context claims were saved for verification.
 </div>
 )}

 <div className="flex flex-col sm:flex-row gap-4 relative z-10">
 <a
 href={result.explorerUrl}
 target="_blank"
 rel="noopener noreferrer"
 className="flex-1 btn-secondary rounded-lg py-3.5 text-center text-sm font-bold text-white transition-all hover:border-white/10 hover:bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl"
 >
 View in Solana Explorer
 </a>
 <a
 href={result.downloadUrl}
 download={`verified_${file?.name}`}
 className="flex-1 rounded-lg bg-white py-3.5 text-center text-sm font-bold text-black transition-all "
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
