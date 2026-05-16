export type SourceTrustTier = 1 | 2 | 3;

export type SourceTrustTierId =
  | "verified-newsroom"
  | "registered-independent"
  | "chain-of-custody";

export interface SourceTrustInfo {
  tier: SourceTrustTier;
  tierId: SourceTrustTierId;
  tierName: string;
  shortLabel: string;
  description: string;
  verifiedByVeritas: boolean;
}

export interface SourceProfile {
  sourceId: string;
  sourceName: string;
  label: string;
  wallet: string;
  trust: SourceTrustInfo;
}

export const SOURCE_TRUST_TIERS: Record<SourceTrustTierId, SourceTrustInfo> = {
  "verified-newsroom": {
    tier: 1,
    tierId: "verified-newsroom",
    tierName: "Tier 1 - Verified Newsroom",
    shortLabel: "Verified newsroom",
    description: "Wallet verified by the Veritas team and associated with a known organization.",
    verifiedByVeritas: true,
  },
  "registered-independent": {
    tier: 2,
    tierId: "registered-independent",
    tierName: "Tier 2 - Registered Independent",
    shortLabel: "Registered independent",
    description: "Self-registered wallet. Timestamped on-chain, but not verified by the Veritas team.",
    verifiedByVeritas: false,
  },
  "chain-of-custody": {
    tier: 3,
    tierId: "chain-of-custody",
    tierName: "Tier 3 - Chain of Custody",
    shortLabel: "Chain of custody",
    description: "A registered independent source record later cited or shared by a verified newsroom.",
    verifiedByVeritas: true,
  },
};

type HardcodedSourceProfile = Omit<SourceProfile, "wallet" | "trust"> & {
  trustTierId: SourceTrustTierId;
};

const SOURCE_PROFILES_BY_WALLET: Record<string, HardcodedSourceProfile> = {
  // Add known devnet Phantom wallet addresses here for Tier 1 newsroom identity.
  // Example:
  // "YourPhantomPublicKey": {
  //   sourceId: "kanal5",
  //   sourceName: "Kanal 5",
  //   label: "Kanal 5 newsroom",
  //   trustTierId: "verified-newsroom",
  // },
};

function getDefaultIndependentSource(wallet: string): SourceProfile {
  return {
    sourceId: "independent",
    sourceName: "Registered Independent",
    label: "Self-registered wallet. Not verified by the Veritas team.",
    wallet,
    trust: SOURCE_TRUST_TIERS["registered-independent"],
  };
}

export function getSourceProfileForWallet(wallet: string): SourceProfile {
  const normalizedWallet = wallet.trim();
  const source = SOURCE_PROFILES_BY_WALLET[normalizedWallet];

  if (!source) return getDefaultIndependentSource(normalizedWallet);

  return {
    sourceId: source.sourceId,
    sourceName: source.sourceName,
    label: source.label,
    wallet: normalizedWallet,
    trust: SOURCE_TRUST_TIERS[source.trustTierId],
  };
}
