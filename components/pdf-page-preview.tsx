"use client";

import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfCitation } from "../lib/types";

if (typeof window !== "undefined") {
  GlobalWorkerOptions.workerSrc = new URL(
    "../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

interface PdfPagePreviewProps {
  file: File;
  citation?: PdfCitation;
}

export default function PdfPagePreview({ file, citation }: PdfPagePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageCount, setPageCount] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(true);

  useEffect(() => {
    let active = true;
    let loadingTask: ReturnType<typeof getDocument> | undefined;
    let cancelRender: (() => void) | undefined;

    async function renderPage(): Promise<void> {
      setIsRendering(true);
      setRenderError(null);
      try {
        loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
        const document = await loadingTask.promise;
        const pageNumber = Math.min(Math.max(citation?.page ?? 1, 1), document.numPages);
        const page = await document.getPage(pageNumber);
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        const containerWidth = containerRef.current?.clientWidth ?? 520;
        if (!canvas || !context) throw new Error("The browser could not create a PDF preview canvas.");

        const baseViewport = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(containerWidth / baseViewport.width, 1.5),
        });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = "100%";
        const task = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        cancelRender = () => task.cancel();
        await task.promise;
        if (active) setPageCount(document.numPages);
      } catch (cause: unknown) {
        if (active) {
          setRenderError(cause instanceof Error ? cause.message : "PDF preview rendering failed.");
        }
      } finally {
        if (active) setIsRendering(false);
      }
    }

    void renderPage();
    return () => {
      active = false;
      cancelRender?.();
      void loadingTask?.destroy();
    };
  }, [citation?.page, file]);

  return (
    <div className="pdf-source">
      <div className="pdf-page-surface" ref={containerRef}>
        <canvas aria-label={`PDF page ${citation?.page ?? 1}`} ref={canvasRef} />
        {citation && (
          <div
            aria-label="Matched source text highlight"
            className="citation-overlay"
            style={{
              left: `${citation.x * 100}%`,
              top: `${citation.y * 100}%`,
              width: `${citation.width * 100}%`,
              height: `${citation.height * 100}%`,
            }}
          />
        )}
      </div>
      <div className="source-caption">
        {renderError
          ? renderError
          : isRendering
            ? "Rendering uploaded PDF locally…"
            : citation
              ? `Page ${citation.page} of ${pageCount} · ${citation.source === "pdf-ocr" ? `OCR source · ${Math.round(citation.confidence ?? 0)}% confidence` : "selectable PDF text"}`
              : `Page 1 of ${pageCount} · no exact matching value was found in the uploaded statement`}
      </div>
    </div>
  );
}
