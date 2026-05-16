import { addChainOfCustodyCitation } from "@/lib/contextStore";
import { assertWalletAuth } from "@/lib/walletAuthServer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const watermarkId = String(body.watermarkId ?? "");
    const citedBy = String(body.citedBy ?? "");
    const note = String(body.note ?? "");

    assertWalletAuth({
      action: "cite-context",
      wallet: citedBy,
      watermarkId,
      payload: { note },
      auth: body.auth,
    });

    const record = await addChainOfCustodyCitation({
      watermarkId,
      citedBy,
      note,
    });

    return Response.json({ record });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not save chain-of-custody citation." },
      { status: 500 },
    );
  }
}
