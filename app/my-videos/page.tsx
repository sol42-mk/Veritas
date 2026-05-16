"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { createBrowserContextHash } from "@/lib/contextCommitment";
import { connectPhantom, getConnectedWallet, sendContextMemo, signWalletAuth } from "@/lib/solana";
import type { StoredContextRecord } from "@/lib/contextTypes";

export default function MyVideosPage() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [records, setRecords] = useState<StoredContextRecord[]>([]);
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getConnectedWallet().then((connectedWallet) => {
      setWallet(connectedWallet);
      if (connectedWallet) {
        void loadRecords(connectedWallet);
      }
    });
  }, []);

  const handleConnect = async () => {
    setError("");
    setStatus("");
    try {
      const connectedWallet = await connectPhantom();
      setWallet(connectedWallet);
      await loadRecords(connectedWallet);
    } catch (caughtError: any) {
      setError(caughtError.message ?? "Could not connect Phantom.");
    }
  };

  const loadRecords = async (registeredBy: string) => {
    setLoading(true);
    setError("");
    setStatus("");

    try {
      const response = await fetch(`/api/context-records?registeredBy=${encodeURIComponent(registeredBy)}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Could not load registered videos.");
      }

      const nextRecords = (body?.records ?? []) as StoredContextRecord[];
      setRecords(nextRecords);
      setUrlDrafts(
        Object.fromEntries(
          nextRecords.map((record) => [record.watermarkId, record.claim.referenceUrl ?? ""]),
        ),
      );
    } catch (caughtError: any) {
      setError(caughtError.message ?? "Could not load registered videos.");
    } finally {
      setLoading(false);
    }
  };

  const saveReferenceUrl = async (record: StoredContextRecord) => {
    if (!wallet) return;

    setError("");
    setStatus("");

    try {
      const claim = {
        ...record.claim,
        referenceUrl: urlDrafts[record.watermarkId] ?? "",
      };
      const contextHash = await createBrowserContextHash({
        watermarkId: record.watermarkId,
        sourceId: record.sourceId,
        sourceName: record.sourceName,
        registeredBy: record.registeredBy,
        transactionSignature: record.transactionSignature,
        contentFingerprint: record.contentFingerprint,
        originalFileName: record.originalFileName,
        claim,
      });
      const contextMemoSignature = await sendContextMemo(
        new PublicKey(wallet),
        record.watermarkId,
        contextHash,
      );
      const auth = await signWalletAuth({
        action: "update-context",
        wallet,
        watermarkId: record.watermarkId,
        payload: { claim: { referenceUrl: claim.referenceUrl }, contextHash, contextMemoSignature },
      });
      const response = await fetch("/api/context-records", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          watermarkId: record.watermarkId,
          registeredBy: wallet,
          claim: { referenceUrl: claim.referenceUrl },
          contextHash,
          contextMemoSignature,
          auth,
        }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Could not update the URL.");
      }

      const updated = body.record as StoredContextRecord;
      setRecords((current) =>
        current.map((item) => (item.watermarkId === updated.watermarkId ? updated : item)),
      );
      setStatus("Original/public URL updated.");
    } catch (caughtError: any) {
      setError(caughtError.message ?? "Could not update the URL.");
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <header className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-wide text-blue-700">My videos</p>
          <h1 className="text-3xl font-semibold text-slate-950">Registered videos</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">
            Connect the same Phantom wallet used for registration to see records saved in the
            Veritas context database and update the original/public video URL.
          </p>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          {!wallet ? (
            <button
              onClick={handleConnect}
              className="rounded-md bg-slate-950 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              Connect Wallet
            </button>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium text-emerald-700">Connected wallet</p>
                <p className="mt-1 break-all font-mono text-xs text-slate-600">{wallet}</p>
              </div>
              <button
                onClick={() => loadRecords(wallet)}
                disabled={loading}
                className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Loading..." : "Refresh"}
              </button>
            </div>
          )}
        </section>

        {error && (
          <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {status && (
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3">
            <p className="text-sm text-emerald-800">{status}</p>
          </div>
        )}

        {wallet && records.length === 0 && !loading && (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center">
            <p className="text-sm font-medium text-slate-950">No saved context records found.</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Older Solana-only registrations will not appear here unless they are backfilled into
              the context database.
            </p>
          </div>
        )}

        <section className="space-y-4">
          {records.map((record) => (
            <article key={record.watermarkId} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
                <div className="space-y-2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Video</p>
                    <p className="mt-1 text-sm font-semibold text-slate-950">{record.originalFileName}</p>
                  </div>
                  <div className="space-y-1 text-xs">
                    <p className="break-all font-mono text-slate-500">watermark: {record.watermarkId}</p>
                    <p className="break-all font-mono text-slate-500">tx: {record.transactionSignature}</p>
                    {record.contextHash && (
                      <p className="break-all font-mono text-slate-500">context: {record.contextHash}</p>
                    )}
                    <p className="text-slate-500">
                      Registered {new Date(record.createdAt).toLocaleString("en-US")}
                    </p>
                  </div>
                  <a
                    href={`/verify?watermarkId=${record.watermarkId}`}
                    className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    Open verification
                  </a>
                </div>

                <div className="space-y-3">
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-500">Original/public video URL</span>
                    <input
                      value={urlDrafts[record.watermarkId] ?? ""}
                      onChange={(event) =>
                        setUrlDrafts((current) => ({
                          ...current,
                          [record.watermarkId]: event.target.value,
                        }))
                      }
                      placeholder="https://..."
                      className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <button
                    onClick={() => saveReferenceUrl(record)}
                    className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800"
                  >
                    Save URL
                  </button>
                  <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                    <div>
                      <span className="block text-slate-400">Location</span>
                      <span>{record.claim.location || "Not set"}</span>
                    </div>
                    <div>
                      <span className="block text-slate-400">Event date</span>
                      <span>{record.claim.eventDate || "Not set"}</span>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="block text-slate-400">Subject</span>
                      <span>{record.claim.subject || "Not set"}</span>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
