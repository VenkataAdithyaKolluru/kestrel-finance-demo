import { documentTextBoxesById, uploadedDocuments } from "./store";
import type { PdfCitation, PdfTextBox, SpreadingData } from "./types";

interface TextLine {
  page: number;
  boxes: PdfTextBox[];
  centerY: number;
}

function groupLines(boxes: PdfTextBox[]): TextLine[] {
  const lines: TextLine[] = [];
  for (const box of [...boxes].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)) {
    const centerY = box.y + box.height / 2;
    const line = lines.find(
      (candidate) =>
        candidate.page === box.page &&
        Math.abs(candidate.centerY - centerY) <= Math.max(0.012, box.height * 0.7),
    );
    if (line) {
      line.boxes.push(box);
      line.centerY =
        line.boxes.reduce((sum, item) => sum + item.y + item.height / 2, 0) / line.boxes.length;
    } else {
      lines.push({ page: box.page, boxes: [box], centerY });
    }
  }
  return lines;
}

function matchesAmount(text: string, amount: number): boolean {
  const compact = text.replace(/\s+/g, "");
  const candidates = compact.match(/(?:₹|Rs\.?)?\d[\d,]*(?:\.\d+)?/gi) ?? [];
  return candidates.some((candidate) => {
    const value = Number(candidate.replace(/[^\d.]/g, ""));
    return Number.isFinite(value) && value === amount;
  });
}

function lineCitation(line: TextLine, documentId: string): PdfCitation {
  const left = Math.min(...line.boxes.map((box) => box.x));
  const top = Math.min(...line.boxes.map((box) => box.y));
  const right = Math.max(...line.boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...line.boxes.map((box) => box.y + box.height));
  const ocrBoxes = line.boxes.filter((box) => box.source === "pdf-ocr");
  return {
    documentId,
    page: line.page,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    source: ocrBoxes.length ? "pdf-ocr" : "pdf-text",
    ...(ocrBoxes.length
      ? {
          confidence:
            ocrBoxes.reduce((sum, box) => sum + (box.confidence ?? 0), 0) / ocrBoxes.length,
        }
      : {}),
  };
}

export function citationsForSpreading(
  applicationId: string,
  spreading: SpreadingData,
): Record<string, PdfCitation> {
  const citations: Record<string, PdfCitation> = {};
  const fields: {
    key: keyof Pick<
      SpreadingData,
      "bankCreditsINR" | "bankDebitsINR" | "bankNetMovementINR" | "gstTurnoverINR"
    >;
    amount: number;
    categories: string[];
  }[] = [
    { key: "bankCreditsINR", amount: spreading.bankCreditsINR, categories: ["bank"] },
    { key: "bankDebitsINR", amount: spreading.bankDebitsINR, categories: ["bank"] },
    { key: "bankNetMovementINR", amount: spreading.bankNetMovementINR, categories: ["bank"] },
    { key: "gstTurnoverINR", amount: spreading.gstTurnoverINR, categories: ["gstr1", "gstr3b"] },
  ];

  for (const field of fields) {
    for (const document of uploadedDocuments) {
      if (document.applicationId !== applicationId || !field.categories.includes(document.category)) continue;
      const lines = groupLines(documentTextBoxesById.get(document.id) ?? []);
      const match = lines.find((line) =>
        matchesAmount(line.boxes.map((box) => box.text).join(" "), field.amount),
      );
      if (match) {
        citations[field.key] = lineCitation(match, document.id);
        break;
      }
    }
  }
  return citations;
}
