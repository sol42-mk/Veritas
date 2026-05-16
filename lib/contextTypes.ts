export interface ContextClaim {
  location?: string;
  eventDate?: string;
  subject?: string;
  description?: string;
  referenceUrl?: string;
}

export type ContextFlagReason =
  | "location"
  | "date"
  | "subject"
  | "description"
  | "other";

export interface ContextFlag {
  id: string;
  reason: ContextFlagReason;
  details: string;
  createdAt: string;
}

export interface ChainOfCustodyCitation {
  id: string;
  citedBy: string;
  citedBySourceName: string;
  note: string;
  createdAt: string;
}

export interface StoredContextRecord {
  watermarkId: string;
  sourceId: string;
  sourceName: string;
  registeredBy: string;
  transactionSignature: string;
  contentFingerprint: string;
  contextHash: string;
  contextMemoSignature: string;
  originalFileName: string;
  claim: ContextClaim;
  flags: ContextFlag[];
  citations: ChainOfCustodyCitation[];
  createdAt: string;
  updatedAt: string;
}
