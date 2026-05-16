export const runtime = "nodejs";

import { getVoteSummary, submitVote } from "@/lib/sourceVotes";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sourceId = searchParams.get("sourceId")?.trim();
  const voterId = searchParams.get("voterId")?.trim() || undefined;

  if (!sourceId) {
    return Response.json({ error: "sourceId is required." }, { status: 400 });
  }

  try {
    const summary = await getVoteSummary(sourceId, voterId);
    return Response.json(summary);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Could not load votes.";
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: { sourceId?: string; voterId?: string; vote?: number };
  try {
    body = (await request.json()) as { sourceId?: string; voterId?: string; vote?: number };
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const sourceId = body.sourceId?.trim();
  const voterId = body.voterId?.trim();
  const vote = body.vote;

  if (!sourceId || !voterId) {
    return Response.json({ error: "sourceId and voterId are required." }, { status: 400 });
  }
  if (vote !== 1 && vote !== -1) {
    return Response.json({ error: "vote must be 1 or -1." }, { status: 400 });
  }

  try {
    const summary = await submitVote(sourceId, voterId, vote as 1 | -1);
    return Response.json(summary);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Could not save vote.";
    return Response.json({ error: msg }, { status: 500 });
  }
}
