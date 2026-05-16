"use client";

import { useEffect, useState } from "react";
import { connectPhantom, getConnectedWallet } from "@/lib/solana";

export default function WalletButton() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    getConnectedWallet().then(setWallet);
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const pubkey = await connectPhantom();
      setWallet(pubkey);
    } catch {
      // User rejected or Phantom not installed
    } finally {
      setConnecting(false);
    }
  };

  if (wallet) {
    return (
      <div className="flex items-center gap-2 bg-white/5 backdrop-blur-md border border-white/10 rounded-full px-4 py-2 ml-4">
        <div className="h-2 w-2 rounded-full bg-purple-400 animate-pulse" />
        <span className="text-xs font-mono text-slate-200">
          {wallet.slice(0, 4)}...{wallet.slice(-4)}
        </span>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={connecting}
      className="btn-primary ml-4 flex items-center gap-2 disabled:opacity-60"
    >
      <svg className="w-4 h-4" viewBox="0 0 128 128" fill="none">
        <circle cx="64" cy="64" r="64" fill="url(#phantom-grad)" />
        <path d="M110.584 64.914H99.142C99.142 44.478 82.462 27.956 61.83 27.956C41.48 27.956 25.0 43.98 24.5 64.1C24.0 84.8 42.7 102.0 63.4 102.0H67.2C86.4 102.0 110.6 83.5 110.6 64.9Z" fill="white" />
        <circle cx="46" cy="62" r="5" fill="#AB9FF2" />
        <circle cx="66" cy="62" r="5" fill="#AB9FF2" />
        <defs>
          <linearGradient id="phantom-grad" x1="0" y1="0" x2="128" y2="128">
            <stop stopColor="#534BB1" />
            <stop offset="1" stopColor="#551BF9" />
          </linearGradient>
        </defs>
      </svg>
      {connecting ? "Connecting..." : "Connect Wallet"}
    </button>
  );
}
