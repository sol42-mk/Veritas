// lib/solana.ts
// Phantom-based transaction signing.
// The browser wallet signs and pays; no server keypair needed.

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  clusterApiUrl,
} from "@solana/web3.js";
import { buildWalletAuthMessage, type WalletAuthAction, type WalletAuthProof } from "@/lib/walletAuth";

export const PROGRAM_ID = new PublicKey(
  "4qBS9B7cZ5r4CeNMaRvxELmZugRroXUwRg8Ss4MP3CVi"
);

const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

export const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

async function assertProgramDeployed(): Promise<void> {
  const accountInfo = await connection.getAccountInfo(PROGRAM_ID);

  if (!accountInfo) {
    throw new Error(
      `The Veritas program is not deployed on Solana devnet yet. Deploy ${PROGRAM_ID.toBase58()} before registering videos.`
    );
  }

  if (!accountInfo.executable) {
    throw new Error(
      `The configured Veritas program account ${PROGRAM_ID.toBase58()} exists, but it is not executable. Check the deployed program ID.`
    );
  }
}

// ─── Phantom provider ──────────────────────────────────────────────────────

// Phantom usually injects window.solana, and newer builds also expose
// window.phantom.solana. Support both so the connect button is less brittle.
function getProvider() {
  if (typeof window === "undefined") return null;
  const phantom = (window as any).phantom?.solana;
  const provider = phantom?.isPhantom ? phantom : (window as any).solana;
  if (!provider?.isPhantom) return null;
  return provider;
}

export async function connectPhantom(): Promise<string> {
  const provider = getProvider();
  if (!provider) {
    throw new Error("Phantom was not detected. Install Phantom, enable the extension for this browser, then refresh the page.");
  }
  const resp = await provider.connect();
  return resp.publicKey.toString();
}

export async function getConnectedWallet(): Promise<string | null> {
  const provider = getProvider();
  if (!provider) return null;
  try {
    // Eager connect does not show a popup if already connected.
    const resp = await provider.connect({ onlyIfTrusted: true });
    return resp.publicKey.toString();
  } catch {
    return null;
  }
}

// ─── PDA helpers ──────────────────────────────────────────────────────────

export function getVideoPDA(watermarkId: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("video"), Buffer.from(watermarkId)],
    PROGRAM_ID
  );
}

// ─── Register transaction ─────────────────────────────────────────────────

// Anchor discriminator for register_video:
// sha256("global:register_video").slice(0, 8)
const REGISTER_IX = Buffer.from([0xd5, 0xa0, 0x0e, 0xa2, 0xcb, 0xf1, 0x9e, 0xc4]);

function encodeString(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length, 0);
  return Buffer.concat([len, b]);
}

export async function buildRegisterTx(
  walletPubkey: PublicKey,
  watermarkId: string,
  videoHash: string,
  sourceId: string,
  sourceName: string,
): Promise<Transaction> {
  await assertProgramDeployed();

  const [pda] = getVideoPDA(watermarkId);

  const data = Buffer.concat([
    REGISTER_IX,
    encodeString(watermarkId),
    encodeString(videoHash),
    encodeString(sourceId),
    encodeString(sourceName),
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pda,                     isSigner: false, isWritable: true  },
      { pubkey: walletPubkey,            isSigner: true,  isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = walletPubkey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  return tx;
}

export async function signAndSendTx(tx: Transaction): Promise<string> {
  const provider = getProvider();
  if (!provider) throw new Error("Phantom is not connected.");

  // Phantom signs and sends in one call
  const { signature } = await provider.signAndSendTransaction(tx);

  // Wait for confirmation
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}

export async function signWalletAuth(input: {
  action: WalletAuthAction;
  wallet: string;
  watermarkId: string;
  payload: Record<string, unknown>;
}): Promise<WalletAuthProof> {
  const provider = getProvider();
  if (!provider) throw new Error("Phantom is not connected.");
  if (typeof provider.signMessage !== "function") {
    throw new Error("This Phantom provider does not support message signing.");
  }

  const issuedAt = new Date().toISOString();
  const message = buildWalletAuthMessage({
    ...input,
    issuedAt,
  });
  const encodedMessage = new TextEncoder().encode(message);
  const signed = await provider.signMessage(encodedMessage, "utf8");
  const signature = signed?.signature;

  if (!signature) {
    throw new Error("Phantom did not return a message signature.");
  }

  return {
    wallet: input.wallet,
    issuedAt,
    signature: bytesToBase64(signature),
  };
}

export async function sendContextMemo(
  walletPubkey: PublicKey,
  watermarkId: string,
  contextHash: string,
): Promise<string> {
  const memo = `veritas_context:${watermarkId}:${contextHash}`;
  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [{ pubkey: walletPubkey, isSigner: true, isWritable: false }],
      data: Buffer.from(memo, "utf8"),
    }),
  );

  tx.feePayer = walletPubkey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  return signAndSendTx(tx);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

// ─── Fetch record ─────────────────────────────────────────────────────────

export interface VideoRecord {
  watermarkId: string;
  videoHash: string;
  sourceId: string;
  sourceName: string;
  timestamp: number;
  registeredBy: string;
}

function readString(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset);
  const str = buf.slice(offset + 4, offset + 4 + len).toString("utf8");
  return [str, offset + 4 + len];
}

export async function fetchVideoRecord(watermarkId: string): Promise<VideoRecord | null> {
  try {
    const [pda] = getVideoPDA(watermarkId);
    const info = await connection.getAccountInfo(pda);
    if (!info) return null;

    const buf = Buffer.from(info.data);
    let o = 8; // skip discriminator
    const [wid, o1]  = readString(buf, o);  o = o1;
    const [hash, o2] = readString(buf, o);  o = o2;
    const [sid, o3]  = readString(buf, o);  o = o3;
    const [sname, o4]= readString(buf, o);  o = o4;
    const ts = Number(buf.readBigInt64LE(o)); o += 8;
    const by = new PublicKey(buf.slice(o, o + 32)).toBase58();

    return { watermarkId: wid, videoHash: hash, sourceId: sid,
             sourceName: sname, timestamp: ts, registeredBy: by };
  } catch {
    return null;
  }
}
