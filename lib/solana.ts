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

export const PROGRAM_ID = new PublicKey(
  "4qBS9B7cZ5r4CeNMaRvxELmZugRroXUwRg8Ss4MP3CVi"
);

export const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

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
