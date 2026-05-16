import { compareContentFingerprints, type FingerprintComparison } from "@/lib/contentFingerprint";
import { getContextRecord } from "@/lib/contextStore";
import { extractServerWatermark, type ServerWatermarkDetection } from "@/lib/serverDctWatermark";
import { getSourceProfileForWallet, type SourceProfile } from "@/lib/sourceRegistry";
import { fetchVideoRecord, type VideoRecord } from "@/lib/veritas";
import type { StoredContextRecord } from "@/lib/contextTypes";

export type ServerVerifyStatus =
  | "verified"
  | "not-found"
  | "fingerprint-mismatch"
  | "no-watermark"
  | "low-confidence";

export interface ServerVerifyResult {
  status: ServerVerifyStatus;
  message: string;
  extraction: ServerWatermarkDetection | null;
  record: VideoRecord | null;
  contextRecord: StoredContextRecord | null;
  sourceProfile: SourceProfile | null;
  fingerprintCheck?: FingerprintComparison;
}

export async function verifyServerVideo(file: File): Promise<ServerVerifyResult> {
  const extraction = await extractServerWatermark(file);

  if (!extraction) {
    return {
      status: "no-watermark",
      message: "No Veritas metadata or DCT watermark could be extracted from this video.",
      extraction: null,
      record: null,
      contextRecord: null,
      sourceProfile: null,
    };
  }

  if (extraction.trusted === false) {
    return {
      status: "low-confidence",
      message: extraction.rejectionReason ?? "A watermark candidate was found, but confidence was too low.",
      extraction,
      record: null,
      contextRecord: null,
      sourceProfile: null,
    };
  }

  const record = await fetchVideoRecord(extraction.watermarkId);

  if (!record) {
    return {
      status: "not-found",
      message: "A Veritas watermark was found, but no matching Solana record exists.",
      extraction,
      record: null,
      contextRecord: null,
      sourceProfile: null,
    };
  }

  const fingerprintCheck = compareContentFingerprints(record.videoHash, extraction.uploadedFingerprint);

  if (!fingerprintCheck.matches) {
    return {
      status: "fingerprint-mismatch",
      message: fingerprintCheck.message,
      extraction,
      record,
      contextRecord: await getContextRecord(extraction.watermarkId),
      sourceProfile: getSourceProfileForWallet(record.registeredBy),
      fingerprintCheck,
    };
  }

  return {
    status: "verified",
    message: "Verified Veritas record found.",
    extraction,
    record,
    contextRecord: await getContextRecord(extraction.watermarkId),
    sourceProfile: getSourceProfileForWallet(record.registeredBy),
    fingerprintCheck,
  };
}
