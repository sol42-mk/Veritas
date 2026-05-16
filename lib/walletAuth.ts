export type WalletAuthAction =
  | "save-context"
  | "update-context"
  | "cite-context";

export interface WalletAuthMessageInput {
  action: WalletAuthAction;
  wallet: string;
  watermarkId: string;
  issuedAt: string;
  payload: Record<string, unknown>;
}

export interface WalletAuthProof {
  wallet: string;
  issuedAt: string;
  signature: string;
}

export function buildWalletAuthMessage(input: WalletAuthMessageInput): string {
  return [
    "Veritas wallet authorization",
    `Action: ${input.action}`,
    `Wallet: ${input.wallet}`,
    `Watermark ID: ${input.watermarkId}`,
    `Issued At: ${input.issuedAt}`,
    `Payload: ${stableStringify(input.payload)}`,
  ].join("\n");
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
