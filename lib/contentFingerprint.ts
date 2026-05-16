export type ContentFingerprintAlgorithm = "videohash" | "sha256" | "unknown";

export interface ParsedContentFingerprint {
  algorithm: ContentFingerprintAlgorithm;
  value: string;
  storageValue: string;
}

export interface FingerprintComparison {
  matches: boolean;
  algorithm: ContentFingerprintAlgorithm;
  message: string;
  distance?: number;
  threshold?: number;
}

const VIDEOHASH_PREFIX = "videohash:";
const DEFAULT_VIDEOHASH_DISTANCE_THRESHOLD = 8;

export function formatVideoHashForStorage(hashHex: string): string {
  const normalized = normalizeHex(hashHex.replace(/^0x/i, ""), 16);
  return `${VIDEOHASH_PREFIX}${normalized}`;
}

export function parseContentFingerprint(value: string): ParsedContentFingerprint {
  const normalized = value.trim().toLowerCase();

  if (normalized.startsWith(VIDEOHASH_PREFIX)) {
    const hash = normalizeHex(normalized.slice(VIDEOHASH_PREFIX.length), 16);
    return {
      algorithm: "videohash",
      value: hash,
      storageValue: `${VIDEOHASH_PREFIX}${hash}`,
    };
  }

  if (/^[a-f0-9]{16}$/.test(normalized)) {
    return {
      algorithm: "videohash",
      value: normalized,
      storageValue: `${VIDEOHASH_PREFIX}${normalized}`,
    };
  }

  if (/^[a-f0-9]{64}$/.test(normalized)) {
    return {
      algorithm: "sha256",
      value: normalized,
      storageValue: normalized,
    };
  }

  return {
    algorithm: "unknown",
    value: normalized,
    storageValue: normalized,
  };
}

export function isValidContentFingerprint(value: string): boolean {
  try {
    return parseContentFingerprint(value).algorithm !== "unknown";
  } catch {
    return false;
  }
}

export function compareContentFingerprints(
  registeredValue: string,
  uploadedValue?: string,
  threshold = DEFAULT_VIDEOHASH_DISTANCE_THRESHOLD,
): FingerprintComparison {
  let registered: ParsedContentFingerprint;
  try {
    registered = parseContentFingerprint(registeredValue);
  } catch {
    return {
      matches: false,
      algorithm: "unknown",
      message: "The registered content fingerprint is invalid.",
    };
  }

  if (registered.algorithm !== "videohash") {
    return {
      matches: true,
      algorithm: registered.algorithm,
      message: "Legacy record does not have a perceptual fingerprint to compare.",
    };
  }

  if (!uploadedValue) {
    return {
      matches: false,
      algorithm: "videohash",
      message: "The record uses VideoHash, but the uploaded video could not be fingerprinted.",
      threshold,
    };
  }

  let uploaded: ParsedContentFingerprint;
  try {
    uploaded = parseContentFingerprint(uploadedValue);
  } catch {
    return {
      matches: false,
      algorithm: "videohash",
      message: "The uploaded VideoHash value is invalid.",
      threshold,
    };
  }
  if (uploaded.algorithm !== "videohash") {
    return {
      matches: false,
      algorithm: "videohash",
      message: "The uploaded fingerprint is not a VideoHash value.",
      threshold,
    };
  }

  const distance = hammingDistanceHex(registered.value, uploaded.value);

  return {
    matches: distance <= threshold,
    algorithm: "videohash",
    message:
      distance <= threshold
        ? `VideoHash matched within threshold (${distance}/${threshold}).`
        : `VideoHash mismatch (${distance}/${threshold}).`,
    distance,
    threshold,
  };
}

function normalizeHex(value: string, expectedLength: number): string {
  const normalized = value.trim().toLowerCase();
  if (!new RegExp(`^[a-f0-9]{${expectedLength}}$`).test(normalized)) {
    throw new Error(`Expected ${expectedLength} hexadecimal characters.`);
  }

  return normalized;
}

function hammingDistanceHex(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new Error("Cannot compare fingerprints with different lengths.");
  }

  let distance = 0;

  for (let i = 0; i < a.length; i += 1) {
    const diff = Number.parseInt(a[i], 16) ^ Number.parseInt(b[i], 16);
    distance += bitCount4(diff);
  }

  return distance;
}

function bitCount4(value: number): number {
  return ((value >> 0) & 1) + ((value >> 1) & 1) + ((value >> 2) & 1) + ((value >> 3) & 1);
}
