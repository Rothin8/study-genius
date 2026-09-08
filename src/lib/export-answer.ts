type ExportCitation = {
  marker: number;
  fileName: string;
  page: number | null;
  snippet: string;
  confidence: number;
};

function cleanMarkdown(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?/g, "").replace(/```$/g, ""))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*\d+\.\s+/gm, (match) => match.trimStart())
    .replace(/[*_~`]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeFileName(value: string) {
  const base = cleanMarkdown(value).split("\n")[0]?.slice(0, 55).trim() || "chat-answer";
  return base.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "-").toLowerCase();
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function citationText(citation: ExportCitation) {
  const page = citation.page == null ? "" : `, page ${citation.page}`;
  return `[${citation.marker}] ${citation.fileName}${page} — ${citation.snippet}`;
}

export async function exportAnswerAsPdf(answer: string, citations: ExportCitation[]) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 54;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const lineWidth = pageWidth - margin * 2;
  let y = margin;

  const addLines = (text: string, size: number, gap: number) => {
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(text, lineWidth) as string[];
    for (const line of lines) {
      if (y > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(line, margin, y);
      y += gap;
    }
  };

  pdf.setFont("helvetica", "bold");
  addLines("Solution.AI — Chat Answer", 18, 24);
  y += 8;
  pdf.setFont("helvetica", "normal");
  addLines(cleanMarkdown(answer), 11, 16);

  if (citations.length > 0) {
    y += 16;
    pdf.setFont("helvetica", "bold");
    addLines("Sources", 13, 20);
    pdf.setFont("helvetica", "normal");
    for (const citation of citations) {
      addLines(citationText(citation), 9, 13);
      y += 5;
    }
  }

  pdf.save(`${safeFileName(answer)}.pdf`);
}

export async function exportAnswerAsWord(answer: string, citations: ExportCitation[]) {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import("docx");
  const answerParagraphs = cleanMarkdown(answer)
    .split("\n")
    .map((text) => new Paragraph({ children: [new TextRun({ text: text || " ", size: 22 })] }));
  const sourceParagraphs = citations.map(
    (citation) =>
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: citationText(citation), size: 18 })],
      }),
  );
  const document = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
          },
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: "Solution.AI — Chat Answer", bold: true })],
          }),
          ...answerParagraphs,
          ...(citations.length > 0
            ? [
                new Paragraph({
                  heading: HeadingLevel.HEADING_2,
                  children: [new TextRun({ text: "Sources", bold: true })],
                }),
                ...sourceParagraphs,
              ]
            : []),
        ],
      },
    ],
  });
  const blob = await Packer.toBlob(document);
  triggerDownload(blob, `${safeFileName(answer)}.docx`);
}