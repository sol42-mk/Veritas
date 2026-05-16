import {
  getContextRecord,
  listContextRecordsByWallet,
  saveContextRecord,
  updateContextClaim,
} from "@/lib/contextStore";
import { assertWalletAuth } from "@/lib/walletAuthServer";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const watermarkId = url.searchParams.get("watermarkId");
    const registeredBy = url.searchParams.get("registeredBy");

    if (registeredBy) {
      const records = await listContextRecordsByWallet(registeredBy);
      return Response.json({ records });
    }

    if (watermarkId) {
      const record = await getContextRecord(watermarkId);
      return Response.json({ record });
    }

    return Response.json({ error: "Missing watermark ID or registered wallet." }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not read context record." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const watermarkId = String(body.watermarkId ?? "");
    const registeredBy = String(body.registeredBy ?? "");
    const claim: Record<string, string> = {};
    for (const field of ["location", "eventDate", "subject", "description", "referenceUrl"]) {
      if (body.claim?.[field] !== undefined) {
        claim[field] = String(body.claim[field]);
      }
    }
    const contextHash = String(body.contextHash ?? "");
    const contextMemoSignature = String(body.contextMemoSignature ?? "");

    assertWalletAuth({
      action: "update-context",
      wallet: registeredBy,
      watermarkId,
      payload: { claim, contextHash, contextMemoSignature },
      auth: body.auth,
    });

    const record = await updateContextClaim({
      watermarkId,
      registeredBy,
      claim,
      contextHash,
      contextMemoSignature,
    });

    return Response.json({ record });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not update context record." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const watermarkId = String(body.watermarkId ?? "");
    const registeredBy = String(body.registeredBy ?? "");
    const payload = {
      sourceId: String(body.sourceId ?? ""),
      sourceName: String(body.sourceName ?? ""),
      transactionSignature: String(body.transactionSignature ?? ""),
      contentFingerprint: String(body.contentFingerprint ?? ""),
      contextHash: String(body.contextHash ?? ""),
      contextMemoSignature: String(body.contextMemoSignature ?? ""),
      originalFileName: String(body.originalFileName ?? ""),
      claim: {
        location: String(body.claim?.location ?? ""),
        eventDate: String(body.claim?.eventDate ?? ""),
        subject: String(body.claim?.subject ?? ""),
        description: String(body.claim?.description ?? ""),
        referenceUrl: String(body.claim?.referenceUrl ?? ""),
      },
    };

    assertWalletAuth({
      action: "save-context",
      wallet: registeredBy,
      watermarkId,
      payload,
      auth: body.auth,
    });

    const record = await saveContextRecord({
      watermarkId,
      sourceId: payload.sourceId,
      sourceName: payload.sourceName,
      registeredBy,
      transactionSignature: payload.transactionSignature,
      contentFingerprint: payload.contentFingerprint,
      contextHash: payload.contextHash,
      contextMemoSignature: payload.contextMemoSignature,
      originalFileName: payload.originalFileName,
      claim: payload.claim,
    });

    return Response.json({ record });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not save context record." },
      { status: 500 },
    );
  }
}
