import { createPublicKey, verify } from "crypto";
import { PublicKey } from "@solana/web3.js";
import {
  buildWalletAuthMessage,
  type WalletAuthAction,
  type WalletAuthProof,
} from "@/lib/walletAuth";

const MAX_AUTH_AGE_MS = 5 * 60 * 1000;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function assertWalletAuth(input: {
  action: WalletAuthAction;
  wallet: string;
  watermarkId: string;
  payload: Record<string, unknown>;
  auth: WalletAuthProof | undefined;
}) {
  const auth = input.auth;
  if (!auth) {
    throw new Error("Missing wallet authorization signature.");
  }

  if (auth.wallet !== input.wallet) {
    throw new Error("Wallet authorization does not match the request wallet.");
  }

  const issuedAt = Date.parse(auth.issuedAt);
  if (!Number.isFinite(issuedAt)) {
    throw new Error("Wallet authorization timestamp is invalid.");
  }

  if (Math.abs(Date.now() - issuedAt) > MAX_AUTH_AGE_MS) {
    throw new Error("Wallet authorization has expired. Please sign again.");
  }

  const message = buildWalletAuthMessage({
    action: input.action,
    wallet: input.wallet,
    watermarkId: input.watermarkId,
    issuedAt: auth.issuedAt,
    payload: input.payload,
  });

  const publicKeyBytes = Buffer.from(new PublicKey(input.wallet).toBytes());
  const keyObject = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyBytes]),
    format: "der",
    type: "spki",
  });

  const signature = Buffer.from(auth.signature, "base64");
  const valid = verify(null, Buffer.from(message, "utf8"), keyObject, signature);

  if (!valid) {
    throw new Error("Wallet authorization signature is invalid.");
  }
}
