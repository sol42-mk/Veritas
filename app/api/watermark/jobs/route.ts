import { createWatermarkJob, getWatermarkJob, getWatermarkJobDownload } from "@/lib/watermarkJobs";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("video");

    if (!(file instanceof File)) {
      return Response.json({ error: "Missing video file." }, { status: 400 });
    }

    const job = createWatermarkJob(file);
    return Response.json({ job });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not start watermark job.",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  if (!jobId) {
    return Response.json({ error: "Missing watermark job ID." }, { status: 400 });
  }

  if (url.searchParams.get("download") === "1") {
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

  const job = getWatermarkJob(jobId);

  if (!job) {
    return Response.json({ error: "Watermark job not found." }, { status: 404 });
  }

  return Response.json({ job });
}
