import { addContextFlag } from "@/lib/contextStore";
import type { ContextFlagReason } from "@/lib/contextTypes";

export const runtime = "nodejs";

const VALID_REASONS = new Set<ContextFlagReason>([
  "location",
  "date",
  "subject",
  "description",
  "other",
]);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const reason = String(body.reason ?? "") as ContextFlagReason;

    if (!VALID_REASONS.has(reason)) {
      return Response.json({ error: "Invalid flag reason." }, { status: 400 });
    }

    const record = await addContextFlag({
      watermarkId: String(body.watermarkId ?? ""),
      reason,
      details: String(body.details ?? ""),
    });

    return Response.json({ record });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not save flag." },
      { status: 500 },
    );
  }
}
