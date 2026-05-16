export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_TEXT_LENGTH = 10_000;

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: { text?: string };
  try {
    body = (await request.json()) as { text?: string };
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return Response.json({ error: "text is required." }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return Response.json(
      { error: `Text is too long. Maximum ${MAX_TEXT_LENGTH.toLocaleString()} characters.` },
      { status: 400 },
    );
  }

  const prompt = `A reader selected the following news text to fact-check:

"${text}"

Search the web and provide:
1. What this text appears to be about (topic, event, people, or location)
2. Relevant factual background found online
3. Whether the claims appear to be accurate, inaccurate, or unverifiable based on what you find
4. Any additional context that helps evaluate the claims

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
      { error: (err as { error?: { message?: string } } | null)?.error?.message ?? "Web search failed." },
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

  return Response.json({ analysis, sources });
}
