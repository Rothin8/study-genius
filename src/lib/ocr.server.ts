const GATEWAY_BASE = "https://ai.gateway.lovable.dev/v1";
const OCR_MODEL = "google/gemini-3.6-flash";

const OCR_PROMPT = `Transcribe every piece of text visible in this scanned page image.
Rules:
- Output plain text / markdown only, no commentary, no code fences.
- Preserve reading order, headings, lists, and table structure where possible.
- Transcribe mathematical expressions as readable plain text.
- If the page contains no readable text, output exactly: [NO_TEXT]`;

/** Runs OCR on base64 data-URL page images via Lovable AI. Returns text per image. */
export async function ocrImages(apiKey: string, images: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const image of images) {
    const res = await fetch(`${GATEWAY_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: OCR_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: OCR_PROMPT },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`OCR request failed [${res.status}]: ${body}`);
      throw new Error(
        res.status === 429
          ? "AI rate limit reached while reading the scan. Try again in a moment."
          : res.status === 402
            ? "AI credits are exhausted for this workspace."
            : `OCR failed (${res.status}).`,
      );
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = (json.choices?.[0]?.message?.content ?? "").trim();
    out.push(text === "[NO_TEXT]" ? "" : text);
  }
  return out;
}
