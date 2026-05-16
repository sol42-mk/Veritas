import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const DATA_DIR = path.join(process.cwd(), ".veritas-data");
const VOTES_PATH = path.join(DATA_DIR, "source-votes.json");
const SUPABASE_VOTES_TABLE = "veritas_source_votes";

export interface VoteSummary {
  likes: number;
  dislikes: number;
  userVote: 1 | -1 | 0;
}

interface VoteEntry {
  sourceId: string;
  voterId: string;
  vote: 1 | -1;
  updatedAt: string;
}

interface VotesFile {
  votes: VoteEntry[];
}

export async function getVoteSummary(sourceId: string, voterId?: string): Promise<VoteSummary> {
  if (isSupabaseConfigured()) {
    try {
      return await getSupabaseVoteSummary(sourceId, voterId);
    } catch (error) {
      console.warn("Supabase vote read failed; falling back to local store.", error);
    }
  }
  return getLocalVoteSummary(sourceId, voterId);
}

export async function submitVote(
  sourceId: string,
  voterId: string,
  vote: 1 | -1,
): Promise<VoteSummary> {
  if (isSupabaseConfigured()) {
    try {
      await upsertSupabaseVote(sourceId, voterId, vote);
      return getSupabaseVoteSummary(sourceId, voterId);
    } catch (error) {
      console.warn("Supabase vote write failed; falling back to local store.", error);
    }
  }
  return upsertLocalVote(sourceId, voterId, vote);
}

// ── Supabase ──────────────────────────────────────────────────────────────────

async function getSupabaseVoteSummary(sourceId: string, voterId?: string): Promise<VoteSummary> {
  const rows = await supabaseFetch<{ vote: number; voter_id: string }[]>(
    `${SUPABASE_VOTES_TABLE}?source_id=eq.${encodeURIComponent(sourceId)}&select=vote,voter_id`,
  );
  const likes = rows.filter((r) => r.vote === 1).length;
  const dislikes = rows.filter((r) => r.vote === -1).length;
  const userVote = voterId
    ? ((rows.find((r) => r.voter_id === voterId)?.vote ?? 0) as 1 | -1 | 0)
    : 0;
  return { likes, dislikes, userVote };
}

async function upsertSupabaseVote(sourceId: string, voterId: string, vote: 1 | -1): Promise<void> {
  await supabaseFetch(`${SUPABASE_VOTES_TABLE}?on_conflict=source_id,voter_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      source_id: sourceId,
      voter_id: voterId,
      vote,
      updated_at: new Date().toISOString(),
    }),
  });
}

// ── Local JSON fallback ───────────────────────────────────────────────────────

async function getLocalVoteSummary(sourceId: string, voterId?: string): Promise<VoteSummary> {
  const file = await readVotesFile();
  const votes = file.votes.filter((v) => v.sourceId === sourceId);
  const likes = votes.filter((v) => v.vote === 1).length;
  const dislikes = votes.filter((v) => v.vote === -1).length;
  const userVote = voterId
    ? ((votes.find((v) => v.voterId === voterId)?.vote ?? 0) as 1 | -1 | 0)
    : 0;
  return { likes, dislikes, userVote };
}

async function upsertLocalVote(
  sourceId: string,
  voterId: string,
  vote: 1 | -1,
): Promise<VoteSummary> {
  const file = await readVotesFile();
  const idx = file.votes.findIndex((v) => v.sourceId === sourceId && v.voterId === voterId);
  const entry: VoteEntry = { sourceId, voterId, vote, updatedAt: new Date().toISOString() };
  if (idx >= 0) {
    file.votes[idx] = entry;
  } else {
    file.votes.push(entry);
  }
  await writeVotesFile(file);
  return getLocalVoteSummary(sourceId, voterId);
}

async function readVotesFile(): Promise<VotesFile> {
  try {
    const raw = await readFile(VOTES_PATH, "utf8");
    return JSON.parse(raw) as VotesFile;
  } catch {
    return { votes: [] };
  }
}

async function writeVotesFile(file: VotesFile): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(VOTES_PATH, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

// ── Supabase helpers (same pattern as contextStore.ts) ────────────────────────

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
  const headers = new Headers(init.headers as HeadersInit);
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Supabase request failed (${response.status}): ${body || response.statusText}`);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}
