import type { ContextClaim } from "@/lib/contextTypes";
import { stableStringify } from "@/lib/walletAuth";

export interface ContextCommitmentInput {
  watermarkId: string;
  sourceId: string;
  sourceName: string;
  registeredBy: string;
  transactionSignature: string;
  contentFingerprint: string;
  originalFileName: string;
  claim: ContextClaim;
}

export function buildContextCommitmentPayload(input: ContextCommitmentInput): Record<string, unknown> {
  return {
    version: "veritas-context-v1",
    watermarkId: input.watermarkId,
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    registeredBy: input.registeredBy,
    transactionSignature: input.transactionSignature,
    contentFingerprint: input.contentFingerprint,
    originalFileName: input.originalFileName,
    claim: {
      location: input.claim.location ?? "",
      eventDate: input.claim.eventDate ?? "",
      subject: input.claim.subject ?? "",
      description: input.claim.description ?? "",
      referenceUrl: input.claim.referenceUrl ?? "",
    },
  };
}

export function stringifyContextCommitment(input: ContextCommitmentInput): string {
  return stableStringify(buildContextCommitmentPayload(input));
}

export async function createBrowserContextHash(input: ContextCommitmentInput): Promise<string> {
  const bytes = new TextEncoder().encode(stringifyContextCommitment(input));
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
