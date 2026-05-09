import { getWatermarkJobDownload } from "@/lib/watermarkJobs";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const download = getWatermarkJobDownload(jobId);

  if (!download) {
    return Response.json({ error: "Watermarked video is not ready." }, { status: 404 });
  }

  const { fileName, result } = download;

  return new Response(new Uint8Array(result.video), {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="veritas_${fileName.replace(/"/g, "")}.mp4"`,
      "X-Veritas-Watermark-Id": result.watermarkId,
      "X-Veritas-Original-Sha256": result.videoHash,
      "X-Veritas-Watermark-Method": result.robust ? "metadata+dct-spread-spectrum" : "metadata-only",
      ...(result.warning ? { "X-Veritas-Warning": result.warning.slice(0, 500) } : {}),
    },
  });
}
