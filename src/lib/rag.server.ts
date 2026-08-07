export type PageInput = { page: number; text: string };
export type Chunk = { content: string; page: number; index: number };

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

export function cleanText(input: string) {
  return input
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Splits page text into overlapping chunks that keep their page number. */
export function chunkPages(pages: PageInput[]): Chunk[] {
  const chunks: Chunk[] = [];
  let index = 0;
  for (const page of pages) {
    const text = cleanText(page.text);
    if (!text) continue;
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + CHUNK_SIZE, text.length);
      if (end < text.length) {
        const breakAt = text.lastIndexOf("\n", end);
        const sentenceAt = text.lastIndexOf(". ", end);
        const cut = Math.max(breakAt, sentenceAt);
        if (cut > start + CHUNK_SIZE * 0.5) end = cut + 1;
      }
      const content = text.slice(start, end).trim();
      if (content.length > 30) chunks.push({ content, page: page.page, index: index++ });
      if (end >= text.length) break;
      start = Math.max(end - CHUNK_OVERLAP, start + 1);
    }
  }
  return chunks;
}

export const RAG_SYSTEM_PROMPT = `You are Solution.AI, a study assistant that answers ONLY from the retrieved excerpts of the student's own uploaded materials.

Rules you must never break:
- Use only the information inside the provided excerpts. Never use outside knowledge and never invent facts.
- Cite sources inline as [1], [2] ... matching the excerpt numbers you used.
- Mention the page number when it is available.
- If the excerpts do not contain the answer, say clearly that the uploaded materials do not cover it and suggest what to upload.
- Be concise, structured, and use markdown (headings, bullets, tables, LaTeX-free plain math) where it helps studying.`;

export type RetrievedChunk = {
  id: string;
  document_id: string;
  file_name: string;
  subject: string | null;
  content: string;
  page_number: number | null;
  chunk_index: number;
  similarity: number;
};

export function buildContextBlock(chunks: RetrievedChunk[]) {
  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] File: ${c.file_name}${c.page_number ? ` | Page: ${c.page_number}` : ""}${
          c.subject ? ` | Subject: ${c.subject}` : ""
        }\n${c.content}`,
    )
    .join("\n\n---\n\n");
}