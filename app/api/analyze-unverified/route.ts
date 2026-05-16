export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const file = formData.get("video");
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing video file." }, { status: 400 });
  }

  // ── Step 1: transcribe audio with Whisper ─────────────────────────────────

  const whisperForm = new FormData();
  whisperForm.append("file", file, file.name || "segment.webm");
  whisperForm.append("model", "whisper-1");

  const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: whisperForm,
  });

  if (!whisperRes.ok) {
    const err = await whisperRes.json().catch(() => null);
    return Response.json(
      { error: err?.error?.message ?? "Transcription failed." },
      { status: 502 },
    );
  }

  const { text: transcript } = (await whisperRes.json()) as { text: string };

  if (!transcript?.trim()) {
    return Response.json(
      { error: "No speech was detected in this video segment." },
      { status: 422 },
    );
  }

  // ── Step 2: web search via OpenAI Responses API ───────────────────────────

  const prompt = `A video segment could not be verified as authentic by a provenance system. Here is a transcript of what is said in the clip:

"${transcript}"

Search the web and provide:
1. What this video clip appears to be about (topic, event, people, or location)
2. Relevant factual background found online
3. Any notable facts, dates, or context that help a viewer evaluate the claims
4. If any claims seem inaccurate or unverifiable, note that briefly

Be concise and factual. Do not speculate beyond what sources support.`;

  const searchRes = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      tools: [{ type: "web_search_preview" }],
      input: prompt,
    }),
  });

  if (!searchRes.ok) {
    const err = await searchRes.json().catch(() => null);
    return Response.json(
      { error: err?.error?.message ?? "Web search failed." },
      { status: 502 },
    );
  }

  const searchData = (await searchRes.json()) as {
    output?: Array<{
      type: string;
      content?: Array<{
        type: string;
        text?: string;
        annotations?: Array<{ type: string; url?: string; title?: string }>;
      }>;
    }>;
  };

  const textBlocks =
    searchData.output
      ?.filter((o) => o.type === "message")
      .flatMap((m) => m.content ?? [])
      .filter((c) => c.type === "output_text") ?? [];

  const analysis = textBlocks.map((c) => c.text ?? "").join("\n");

  const seen = new Set<string>();
  const sources = textBlocks
    .flatMap((c) => c.annotations ?? [])
    .filter((a) => a.type === "url_citation" && a.url)
    .filter((a) => {
      if (seen.has(a.url!)) return false;
      seen.add(a.url!);
      return true;
    })
    .map((a) => ({ title: a.title || a.url!, url: a.url! }));

  return Response.json({ transcript, analysis, sources });
}
