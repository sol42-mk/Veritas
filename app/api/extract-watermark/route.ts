import { extractServerWatermark } from "@/lib/serverDctWatermark";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("video");

    if (!(file instanceof File)) {
      return Response.json({ error: "Missing video file." }, { status: 400 });
    }

    const result = await extractServerWatermark(file);
    return Response.json({ watermark: result });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not extract a Veritas watermark.",
      },
      { status: 500 }
    );
  }
}
