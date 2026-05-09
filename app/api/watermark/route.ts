import { embedServerWatermark } from "@/lib/serverDctWatermark";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("video");

    if (!(file instanceof File)) {
      return Response.json({ error: "Missing video file." }, { status: 400 });
    }

    const result = await embedServerWatermark(file);

    return new Response(new Uint8Array(result.video), {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="veritas_${file.name.replace(/"/g, "")}.mp4"`,
        "X-Veritas-Watermark-Id": result.watermarkId,
        "X-Veritas-Original-Sha256": result.videoHash,
        "X-Veritas-Watermark-Method": result.robust ? "metadata+dct-spread-spectrum" : "metadata-only",
        ...(result.warning ? { "X-Veritas-Warning": result.warning.slice(0, 500) } : {}),
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not watermark this video.",
      },
      { status: 500 }
    );
  }
}
