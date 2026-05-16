import { verifyServerVideo } from "@/lib/serverVerifyVideo";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("video");

    if (!(file instanceof File)) {
      return Response.json({ error: "Missing video file." }, { status: 400 });
    }

    const result = await verifyServerVideo(file);
    return Response.json({ result });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not verify this video.",
      },
      { status: 500 },
    );
  }
}
