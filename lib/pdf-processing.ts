import { PDFParse } from "pdf-parse";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createWorker, OEM } from "tesseract.js";
import {
  GlobalWorkerOptions,
  getDocument,
  Util,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Block } from "tesseract.js";
import type { PdfTextBox } from "./types";

interface PdfJsTextItem {
  str: string;
  dir: string;
  fontName: string;
  hasEOL: boolean;
  transform: number[];
  width: number;
  height: number;
}

export interface ProcessedPdf {
  pageCount: number;
  text: string;
  boxes: PdfTextBox[];
  ocrApplied: boolean;
}

const maxPages = 60;
const minimumSearchablePageCharacters = 24;
const workerUrl = pathToFileURL(
  resolve(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"),
).href;

PDFParse.setWorker(workerUrl);
GlobalWorkerOptions.workerSrc = workerUrl;

function isTextItem(item: unknown): item is PdfJsTextItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    typeof item.str === "string" &&
    "transform" in item &&
    Array.isArray(item.transform) &&
    "width" in item &&
    typeof item.width === "number" &&
    "height" in item &&
    typeof item.height === "number"
  );
}

function bounded(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

function textBox(
  item: PdfJsTextItem,
  pageNumber: number,
  viewportWidth: number,
  viewportHeight: number,
): PdfTextBox | null {
  const transformed = Util.transform([1, 0, 0, -1, 0, viewportHeight], item.transform);
  const fontHeight = Math.hypot(transformed[2], transformed[3]);
  const left = bounded(transformed[4], viewportWidth);
  const top = bounded(transformed[5] - fontHeight, viewportHeight);
  const width = Math.min(item.width, viewportWidth - left);
  const height = Math.min(fontHeight, viewportHeight - top);
  if (!item.str.trim() || width <= 0 || height <= 0) return null;
  return {
    text: item.str,
    page: pageNumber,
    x: left / viewportWidth,
    y: top / viewportHeight,
    width: width / viewportWidth,
    height: height / viewportHeight,
    source: "pdf-text",
  };
}

function ocrBoxes(
  blocks: Block[],
  pageNumber: number,
  imageWidth: number,
  imageHeight: number,
): PdfTextBox[] {
  const boxes: PdfTextBox[] = [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          const { x0, y0, x1, y1 } = word.bbox;
          if (!word.text.trim() || x1 <= x0 || y1 <= y0) continue;
          boxes.push({
            text: word.text,
            page: pageNumber,
            x: bounded(x0, imageWidth) / imageWidth,
            y: bounded(y0, imageHeight) / imageHeight,
            width: Math.min(x1, imageWidth) / imageWidth - bounded(x0, imageWidth) / imageWidth,
            height: Math.min(y1, imageHeight) / imageHeight - bounded(y0, imageHeight) / imageHeight,
            source: "pdf-ocr",
            confidence: word.confidence,
          });
        }
      }
    }
  }
  return boxes;
}

export async function processPdf(bytes: Uint8Array): Promise<ProcessedPdf> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  let pdf: PDFDocumentProxy | undefined;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    const loadingTask = getDocument({ data: new Uint8Array(bytes) });
    pdf = await loadingTask.promise;
    if (pdf.numPages > maxPages) {
      throw new Error(`PDFs over ${maxPages} pages are not supported by this demo.`);
    }

    const pageTexts: string[] = [];
    const boxes: PdfTextBox[] = [];
    const pagesNeedingOcr: number[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.filter(
        (item): item is PdfJsTextItem => isTextItem(item),
      );
      const text = items.map((item) => item.str).filter(Boolean).join(" ");
      pageTexts.push(text);
      for (const item of items) {
        const box = textBox(item, pageNumber, viewport.width, viewport.height);
        if (box) boxes.push(box);
      }
      if (text.trim().length < minimumSearchablePageCharacters) {
        pagesNeedingOcr.push(pageNumber);
      }
    }

    if (pagesNeedingOcr.length > 0) {
      const localModelPath = resolve(process.cwd(), "node_modules", "@tesseract.js-data", "eng", "4.0.0");
      worker = await createWorker("eng", OEM.LSTM_ONLY, {
        langPath: localModelPath,
        gzip: true,
        cacheMethod: "none",
      });
      for (const pageNumber of pagesNeedingOcr) {
        const screenshots = await parser.getScreenshot({
          partial: [pageNumber],
          desiredWidth: 1400,
          imageBuffer: true,
          imageDataUrl: false,
        });
        const image = screenshots.pages[0];
        if (!image?.data.length) continue;
        const result = await worker.recognize(Buffer.from(image.data), {}, { blocks: true });
        pageTexts[pageNumber - 1] = result.data.text;
        boxes.push(...ocrBoxes(result.data.blocks ?? [], pageNumber, image.width, image.height));
      }
    }

    return {
      pageCount: pdf.numPages,
      text: pageTexts.join("\n"),
      boxes,
      ocrApplied: pagesNeedingOcr.length > 0,
    };
  } finally {
    if (worker) await worker.terminate();
    if (pdf) await pdf.destroy();
    await parser.destroy();
  }
}
