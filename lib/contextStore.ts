import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type {
  ChainOfCustodyCitation,
  ContextClaim,
  ContextFlag,
  ContextFlagReason,
  StoredContextRecord,
} from "@/lib/contextTypes";
import { stringifyContextCommitment } from "@/lib/contextCommitment";
import { getSourceProfileForWallet } from "@/lib/sourceRegistry";

const DATA_DIR = path.join(process.cwd(), ".veritas-data");
const CONTEXT_STORE_PATH = path.join(DATA_DIR, "context-records.json");
const MAX_TEXT_LENGTH = 500;
const MAX_URL_LENGTH = 500;
const SUPABASE_CONTEXT_TABLE = "veritas_context_records";
const SUPABASE_FLAGS_TABLE = "veritas_context_flags";
const SUPABASE_CITATIONS_TABLE = "veritas_context_citations";

interface ContextStoreFile {
  records: Record<string, StoredContextRecord>;
}

export async function saveContextRecord(input: {
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
}): Promise<StoredContextRecord> {
  const watermarkId = normalizeWatermarkId(input.watermarkId);
  const now = new Date().toISOString();
  const existing = await getContextRecord(watermarkId);
  const sanitizedClaim = sanitizeClaim(input.claim);
  const computedHash = computeContextHash({
    watermarkId,
    sourceId: trimText(input.sourceId, 64),
    sourceName: trimText(input.sourceName, 128),
    registeredBy: trimText(input.registeredBy, 64),
    transactionSignature: trimText(input.transactionSignature, 128),
    contentFingerprint: trimText(input.contentFingerprint, 128),
    originalFileName: trimText(input.originalFileName, 256),
    claim: sanitizedClaim,
  });

  if (input.contextHash !== computedHash) {
    throw new Error("Context hash does not match the submitted context package.");
  }

  const record: StoredContextRecord = {
    watermarkId,
    sourceId: trimText(input.sourceId, 64),
    sourceName: trimText(input.sourceName, 128),
    registeredBy: trimText(input.registeredBy, 64),
    transactionSignature: trimText(input.transactionSignature, 128),
    contentFingerprint: trimText(input.contentFingerprint, 128),
    contextHash: computedHash,
    contextMemoSignature: trimText(input.contextMemoSignature, 128),
    originalFileName: trimText(input.originalFileName, 256),
    claim: sanitizedClaim,
    flags: existing?.flags ?? [],
    citations: existing?.citations ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (isSupabaseConfigured()) {
    try {
      await upsertSupabaseContextRecord(record);
      return record;
    } catch (error) {
      console.warn("Supabase context save failed; falling back to local store.", error);
    }
  }

  const store = await readStore();
  store.records[watermarkId] = record;
  await writeStore(store);
  return record;
}

export async function getContextRecord(watermarkId: string): Promise<StoredContextRecord | null> {
  const normalizedWatermarkId = normalizeWatermarkId(watermarkId);

  if (isSupabaseConfigured()) {
    try {
      return await getSupabaseContextRecord(normalizedWatermarkId);
    } catch (error) {
      console.warn("Supabase context read failed; falling back to local store.", error);
    }
  }

  const store = await readStore();
  const record = store.records[normalizedWatermarkId];
  return record ? normalizeStoredRecord(record) : null;
}

export async function listContextRecordsByWallet(wallet: string): Promise<StoredContextRecord[]> {
  const registeredBy = trimText(wallet, 64);
  if (!registeredBy) return [];

  if (isSupabaseConfigured()) {
    try {
      return await listSupabaseContextRecordsByWallet(registeredBy);
    } catch (error) {
      console.warn("Supabase context list failed; falling back to local store.", error);
    }
  }

  const store = await readStore();
  return Object.values(store.records)
    .filter((record) => record.registeredBy === registeredBy)
    .map(normalizeStoredRecord)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateContextClaim(input: {
  watermarkId: string;
  registeredBy: string;
  claim: Partial<ContextClaim>;
  contextHash: string;
  contextMemoSignature: string;
}): Promise<StoredContextRecord> {
  const watermarkId = normalizeWatermarkId(input.watermarkId);
  const registeredBy = trimText(input.registeredBy, 64);
  const existing = await getContextRecord(watermarkId);

  if (!existing) {
    throw new Error("No context record exists for this watermark ID.");
  }

  if (existing.registeredBy !== registeredBy) {
    throw new Error("Only the registering wallet can update this context record.");
  }

  const updatedAt = new Date().toISOString();
  const claim = sanitizeClaim({ ...existing.claim, ...input.claim });
  const computedHash = computeContextHash({
    watermarkId,
    sourceId: existing.sourceId,
    sourceName: existing.sourceName,
    registeredBy: existing.registeredBy,
    transactionSignature: existing.transactionSignature,
    contentFingerprint: existing.contentFingerprint,
    originalFileName: existing.originalFileName,
    claim,
  });

  if (input.contextHash !== computedHash) {
    throw new Error("Context hash does not match the updated context package.");
  }

  const updated: StoredContextRecord = {
    ...existing,
    claim,
    contextHash: computedHash,
    contextMemoSignature: trimText(input.contextMemoSignature, 128),
    updatedAt,
  };

  if (isSupabaseConfigured()) {
    try {
      await updateSupabaseContextClaim(
        watermarkId,
        updated.claim,
        updated.contextHash,
        updated.contextMemoSignature,
        updatedAt,
      );
      return updated;
    } catch (error) {
      console.warn("Supabase context update failed; falling back to local store.", error);
    }
  }

  const store = await readStore();
  store.records[watermarkId] = updated;
  await writeStore(store);
  return updated;
}

export async function addContextFlag(input: {
  watermarkId: string;
  reason: ContextFlagReason;
  details: string;
}): Promise<StoredContextRecord> {
  const watermarkId = normalizeWatermarkId(input.watermarkId);
  const record = await getContextRecord(watermarkId);

  if (!record) {
    throw new Error("No context record exists for this watermark ID.");
  }

  const flag: ContextFlag = {
    id: randomUUID(),
    reason: input.reason,
    details: trimText(input.details, MAX_TEXT_LENGTH),
    createdAt: new Date().toISOString(),
  };

  if (!flag.details) {
    throw new Error("Flag details are required.");
  }

  const updatedRecord: StoredContextRecord = {
    ...record,
    flags: [...record.flags, flag],
    updatedAt: flag.createdAt,
  };

  if (isSupabaseConfigured()) {
    try {
      await insertSupabaseContextFlag(watermarkId, flag);
      await touchSupabaseContextRecord(watermarkId, flag.createdAt);
      return updatedRecord;
    } catch (error) {
      console.warn("Supabase flag save failed; falling back to local store.", error);
    }
  }

  const store = await readStore();
  store.records[watermarkId] = updatedRecord;
  await writeStore(store);
  return updatedRecord;
}

export async function addChainOfCustodyCitation(input: {
  watermarkId: string;
  citedBy: string;
  note: string;
}): Promise<StoredContextRecord> {
  const watermarkId = normalizeWatermarkId(input.watermarkId);
  const citedBy = trimText(input.citedBy, 64);
  const record = await getContextRecord(watermarkId);

  if (!record) {
    throw new Error("No context record exists for this watermark ID.");
  }

  const citingSource = getSourceProfileForWallet(citedBy);
  if (citingSource.trust.tier !== 1) {
    throw new Error("Only a Tier 1 verified newsroom wallet can create a chain-of-custody citation.");
  }

  const citation: ChainOfCustodyCitation = {
    id: randomUUID(),
    citedBy,
    citedBySourceName: citingSource.sourceName,
    note: trimText(input.note, MAX_TEXT_LENGTH),
    createdAt: new Date().toISOString(),
  };

  const updatedRecord: StoredContextRecord = {
    ...record,
    citations: [...(record.citations ?? []), citation],
    updatedAt: citation.createdAt,
  };

  if (isSupabaseConfigured()) {
    try {
      await insertSupabaseContextCitation(watermarkId, citation);
      await touchSupabaseContextRecord(watermarkId, citation.createdAt);
      return updatedRecord;
    } catch (error) {
      console.warn("Supabase citation save failed; falling back to local store.", error);
    }
  }

  const store = await readStore();
  store.records[watermarkId] = updatedRecord;
  await writeStore(store);
  return updatedRecord;
}

async function upsertSupabaseContextRecord(record: StoredContextRecord): Promise<void> {
  await supabaseFetch(`${SUPABASE_CONTEXT_TABLE}?on_conflict=watermark_id`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      watermark_id: record.watermarkId,
      source_id: record.sourceId,
      source_name: record.sourceName,
      registered_by: record.registeredBy,
      transaction_signature: record.transactionSignature,
      content_fingerprint: record.contentFingerprint,
      context_hash: record.contextHash,
      context_memo_signature: record.contextMemoSignature,
      original_file_name: record.originalFileName,
      claim: record.claim,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    }),
  });
}

async function getSupabaseContextRecord(watermarkId: string): Promise<StoredContextRecord | null> {
  const rows = await supabaseFetch<SupabaseContextRow[]>(
    `${SUPABASE_CONTEXT_TABLE}?watermark_id=eq.${encodeURIComponent(watermarkId)}&select=*`,
  );

  const row = rows[0];
  if (!row) return null;

  const [flags, citations] = await Promise.all([
    getSupabaseFlags(watermarkId),
    getSupabaseCitations(watermarkId),
  ]);

  return {
    watermarkId: row.watermark_id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    registeredBy: row.registered_by,
    transactionSignature: row.transaction_signature,
    contentFingerprint: row.content_fingerprint,
    contextHash: row.context_hash,
    contextMemoSignature: row.context_memo_signature,
    originalFileName: row.original_file_name,
    claim: row.claim ?? {},
    flags,
    citations,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listSupabaseContextRecordsByWallet(wallet: string): Promise<StoredContextRecord[]> {
  const rows = await supabaseFetch<SupabaseContextRow[]>(
    `${SUPABASE_CONTEXT_TABLE}?registered_by=eq.${encodeURIComponent(wallet)}&select=*&order=created_at.desc`,
  );

  return Promise.all(
    rows.map(async (row) => {
      const [flags, citations] = await Promise.all([
        getSupabaseFlags(row.watermark_id),
        getSupabaseCitations(row.watermark_id),
      ]);

      return {
        watermarkId: row.watermark_id,
        sourceId: row.source_id,
        sourceName: row.source_name,
        registeredBy: row.registered_by,
        transactionSignature: row.transaction_signature,
        contentFingerprint: row.content_fingerprint,
        contextHash: row.context_hash,
        contextMemoSignature: row.context_memo_signature,
        originalFileName: row.original_file_name,
        claim: row.claim ?? {},
        flags,
        citations,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }),
  );
}

async function getSupabaseFlags(watermarkId: string): Promise<ContextFlag[]> {
  const flags = await supabaseFetch<SupabaseFlagRow[]>(
    `${SUPABASE_FLAGS_TABLE}?watermark_id=eq.${encodeURIComponent(watermarkId)}&select=*&order=created_at.asc`,
  );

  return flags.map((flag) => ({
    id: flag.id,
    reason: flag.reason,
    details: flag.details,
    createdAt: flag.created_at,
  }));
}

async function getSupabaseCitations(watermarkId: string): Promise<ChainOfCustodyCitation[]> {
  const citations = await supabaseFetch<SupabaseCitationRow[]>(
    `${SUPABASE_CITATIONS_TABLE}?watermark_id=eq.${encodeURIComponent(watermarkId)}&select=*&order=created_at.asc`,
  );

  return citations.map((citation) => ({
    id: citation.id,
    citedBy: citation.cited_by,
    citedBySourceName: citation.cited_by_source_name,
    note: citation.note,
    createdAt: citation.created_at,
  }));
}

async function updateSupabaseContextClaim(
  watermarkId: string,
  claim: ContextClaim,
  contextHash: string,
  contextMemoSignature: string,
  updatedAt: string,
): Promise<void> {
  await supabaseFetch(`${SUPABASE_CONTEXT_TABLE}?watermark_id=eq.${encodeURIComponent(watermarkId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      claim,
      context_hash: contextHash,
      context_memo_signature: contextMemoSignature,
      updated_at: updatedAt,
    }),
  });
}

async function insertSupabaseContextFlag(watermarkId: string, flag: ContextFlag): Promise<void> {
  await supabaseFetch(SUPABASE_FLAGS_TABLE, {
    method: "POST",
    body: JSON.stringify({
      id: flag.id,
      watermark_id: watermarkId,
      reason: flag.reason,
      details: flag.details,
      created_at: flag.createdAt,
    }),
  });
}

async function insertSupabaseContextCitation(
  watermarkId: string,
  citation: ChainOfCustodyCitation,
): Promise<void> {
  await supabaseFetch(SUPABASE_CITATIONS_TABLE, {
    method: "POST",
    body: JSON.stringify({
      id: citation.id,
      watermark_id: watermarkId,
      cited_by: citation.citedBy,
      cited_by_source_name: citation.citedBySourceName,
      note: citation.note,
      created_at: citation.createdAt,
    }),
  });
}

async function touchSupabaseContextRecord(watermarkId: string, updatedAt: string): Promise<void> {
  await supabaseFetch(`${SUPABASE_CONTEXT_TABLE}?watermark_id=eq.${encodeURIComponent(watermarkId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      updated_at: updatedAt,
    }),
  });
}

function sanitizeClaim(claim: ContextClaim): ContextClaim {
  return {
    location: trimText(claim.location, MAX_TEXT_LENGTH),
    eventDate: trimText(claim.eventDate, 64),
    subject: trimText(claim.subject, MAX_TEXT_LENGTH),
    description: trimText(claim.description, MAX_TEXT_LENGTH),
    referenceUrl: trimText(claim.referenceUrl, MAX_URL_LENGTH),
  };
}

async function readStore(): Promise<ContextStoreFile> {
  try {
    const raw = await readFile(CONTEXT_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as ContextStoreFile;
    return { records: parsed.records ?? {} };
  } catch {
    return { records: {} };
  }
}

async function writeStore(store: ContextStoreFile): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CONTEXT_STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function normalizeWatermarkId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalized)) {
    throw new Error("Invalid watermark ID.");
  }

  return normalized;
}

function trimText(value: string | undefined, maxLength: number): string {
  return (value ?? "").trim().slice(0, maxLength);
}

function normalizeStoredRecord(record: StoredContextRecord): StoredContextRecord {
  return {
    ...record,
    contextHash: record.contextHash ?? "",
    contextMemoSignature: record.contextMemoSignature ?? "",
    flags: record.flags ?? [],
    citations: record.citations ?? [],
  };
}

function computeContextHash(input: {
  watermarkId: string;
  sourceId: string;
  sourceName: string;
  registeredBy: string;
  transactionSignature: string;
  contentFingerprint: string;
  originalFileName: string;
  claim: ContextClaim;
}): string {
  return createHash("sha256")
    .update(stringifyContextCommitment(input), "utf8")
    .digest("hex");
}

interface SupabaseContextRow {
  watermark_id: string;
  source_id: string;
  source_name: string;
  registered_by: string;
  transaction_signature: string;
  content_fingerprint: string;
  context_hash: string;
  context_memo_signature: string;
  original_file_name: string;
  claim: ContextClaim | null;
  created_at: string;
  updated_at: string;
}

interface SupabaseFlagRow {
  id: string;
  watermark_id: string;
  reason: ContextFlagReason;
  details: string;
  created_at: string;
}

interface SupabaseCitationRow {
  id: string;
  watermark_id: string;
  cited_by: string;
  cited_by_source_name: string;
  note: string;
  created_at: string;
}

function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseKey());
}

function getSupabaseUrl(): string {
  return (
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    ""
  ).replace(/\/$/, "");
}

function getSupabaseKey(): string {
  return (
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ""
  );
}

async function supabaseFetch<T = unknown>(
  pathAndQuery: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${getSupabaseUrl()}/rest/v1/${pathAndQuery}`;
  const key = getSupabaseKey();
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Supabase request failed (${response.status}): ${body || response.statusText}`);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  return text ? JSON.parse(text) as T : undefined as T;
}
