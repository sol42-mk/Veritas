import { getWatermarkJob } from "@/lib/watermarkJobs";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const job = getWatermarkJob(jobId);

  if (!job) {
    return Response.json({ error: "Watermark job not found." }, { status: 404 });
  }

  return Response.json({ job });
}
