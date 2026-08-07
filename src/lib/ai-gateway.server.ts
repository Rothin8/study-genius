import { createOpenAI } from "@ai-sdk/openai";

const GATEWAY_BASE = "https://ai.gateway.lovable.dev/v1";

export function getLovableApiKey() {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured for this project.");
  return key;
}

export function createResponsesProvider(lovableApiKey: string) {
  return createOpenAI({
    baseURL: GATEWAY_BASE,
    apiKey: lovableApiKey,
    headers: {
      "Lovable-API-Key": lovableApiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
  });
}

/** Embeds text with Lovable AI. Batches of <=100 inputs per request. */
export async function embedTexts(lovableApiKey: string, inputs: string[]) {
  const vectors: number[][] = [];
  for (let i = 0; i < inputs.length; i += 100) {
    const batch = inputs.slice(i, i + 100);
    const res = await fetch(`${GATEWAY_BASE}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": lovableApiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({ model: "google/gemini-embedding-2", input: batch }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`Embedding request failed [${res.status}]: ${body}`);
      throw new Error(
        res.status === 429
          ? "AI rate limit reached. Please try again in a moment."
          : res.status === 402
            ? "AI credits are exhausted for this workspace."
            : `Embedding failed (${res.status}).`,
      );
    }
    const json = (await res.json()) as {
      data: { index: number; embedding: number[] }[];
    };
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    for (const item of sorted) vectors.push(item.embedding);
  }
  return vectors;
}