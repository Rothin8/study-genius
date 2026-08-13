import type { PDFPageProxy } from "pdfjs-dist";

export type ExtractedPage = { page: number; text: string };
export type OcrFn = (images: string[]) => Promise<string[]>;
export type ProgressFn = (message: string) => void;

const MAX_SIZE = 50 * 1024 * 1024;
const MIN_TEXT_PER_PAGE = 80;
const MAX_OCR_PAGES = 60;
const OCR_BATCH = 4;

export async function extractPages(
  file: File,
  ocr?: OcrFn,
  onProgress?: ProgressFn,
): Promise<ExtractedPage[]> {
  if (file.size > MAX_SIZE) throw new Error("Files must be 50MB or smaller.");
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) return extractPdf(file, ocr, onProgress);
  if (name.endsWith(".docx")) return extractDocx(file);
  if (/\.(png|jpe?g|webp)$/.test(name) || file.type.startsWith("image/")) {
    return extractImage(file, ocr);
  }
  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".csv") ||
    file.type.startsWith("text/")
  ) {
    const text = await file.text();
    return [{ page: 1, text }];
  }
  throw new Error("Unsupported file type. Upload a PDF, DOCX, image, TXT or Markdown file.");
}

async function extractPdf(
  file: File,
  ocr?: OcrFn,
  onProgress?: ProgressFn,
): Promise<ExtractedPage[]> {
  const pdfjs = await import("pdfjs-dist");
  const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;

  const pages: ExtractedPage[] = [];
  const needsOcr: number[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    if (i % 10 === 0) onProgress?.(`Reading page ${i} of ${pdf.numPages}...`);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .trim();
    if (text.length >= MIN_TEXT_PER_PAGE) pages.push({ page: i, text });
    else if (text) pages.push({ page: i, text });
    if (text.length < MIN_TEXT_PER_PAGE) needsOcr.push(i);
  }

  if (ocr && needsOcr.length > 0) {
    const targets = needsOcr.slice(0, MAX_OCR_PAGES);
    for (let start = 0; start < targets.length; start += OCR_BATCH) {
      const batch = targets.slice(start, start + OCR_BATCH);
      onProgress?.(
        `Running OCR on scanned pages ${start + 1}-${start + batch.length} of ${targets.length}...`,
      );
      const images: string[] = [];
      for (const pageNumber of batch) {
        images.push(await renderPageImage(await pdf.getPage(pageNumber)));
      }
      const texts = await ocr(images);
      batch.forEach((pageNumber, idx) => {
        const ocrText = (texts[idx] ?? "").trim();
        if (!ocrText) return;
        const existing = pages.find((p) => p.page === pageNumber);
        if (existing) existing.text = `${existing.text}\n${ocrText}`.trim();
        else pages.push({ page: pageNumber, text: ocrText });
      });
    }
    pages.sort((a, b) => a.page - b.page);
  }

  const usable = pages.filter((p) => p.text.trim().length > 0);
  if (usable.length === 0) {
    throw new Error(
      needsOcr.length > 0
        ? "Could not read any text from this scan, even with OCR. Try a clearer or higher-resolution file."
        : "No readable text found in this PDF.",
    );
  }
  return usable;
}

async function renderPageImage(page: PDFPageProxy): Promise<string> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(1.8, 1600 / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not render this page for OCR.");
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.75);
}

async function extractImage(file: File, ocr?: OcrFn): Promise<ExtractedPage[]> {
  if (!ocr) throw new Error("OCR is unavailable right now — try again in a moment.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read this image."));
    reader.readAsDataURL(file);
  });
  const [text] = await ocr([dataUrl]);
  if (!text?.trim()) throw new Error("No readable text found in this image.");
  return [{ page: 1, text }];
}

async function extractDocx(file: File): Promise<ExtractedPage[]> {
  const mammoth = await import("mammoth");
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  const text = result.value.trim();
  if (!text) throw new Error("No text found in this document.");
  return [{ page: 1, text }];
}
