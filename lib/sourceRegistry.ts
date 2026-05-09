export interface SourceProfile {
  sourceId: string;
  sourceName: string;
  label: string;
}

const SOURCE_PROFILES_BY_WALLET: Record<string, SourceProfile> = {
  // Add known devnet Phantom wallet addresses here.
  // Example:
  // "YourPhantomPublicKey": {
  //   sourceId: "kanal5",
  //   sourceName: "Kanal 5",
  //   label: "Kanal 5 newsroom",
  // },
};

const DEFAULT_INDEPENDENT_SOURCE: SourceProfile = {
  sourceId: "independent",
  sourceName: "Independent Journalist",
  label: "Independent contributor",
};

export function getSourceProfileForWallet(wallet: string): SourceProfile {
  return SOURCE_PROFILES_BY_WALLET[wallet] ?? DEFAULT_INDEPENDENT_SOURCE;
}
