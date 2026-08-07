export type ExtractedPage = { page: number; text: string };

const MAX_SIZE = 20 * 1024 * 1024;

export async function extractPages(file: File): Promise<ExtractedPage[]> {
  if (file.size > MAX_SIZE) throw new Error("Files must be 20MB or smaller.");
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) return extractPdf(file);
  if (name.endsWith(".docx")) return extractDocx(file);
  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".csv") ||
    file.type.startsWith("text/")
  ) {
    const text = await file.text();
    return [{ page: 1, text }];
  }
  throw new Error("Unsupported file type. Upload a PDF, DOCX, TXT or Markdown file.");
}

async function extractPdf(file: File): Promise<ExtractedPage[]> {
  const pdfjs = await import("pdfjs-dist");
  const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const pages: ExtractedPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .trim();
    if (text) pages.push({ page: i, text });
  }
  if (pages.length === 0) {
    throw new Error(
      "No selectable text found — this looks like a scanned PDF. Try a text-based PDF for now.",
    );
  }
  return pages;
}

async function extractDocx(file: File): Promise<ExtractedPage[]> {
  const mammoth = await import("mammoth");
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  const text = result.value.trim();
  if (!text) throw new Error("No text found in this document.");
  return [{ page: 1, text }];
}