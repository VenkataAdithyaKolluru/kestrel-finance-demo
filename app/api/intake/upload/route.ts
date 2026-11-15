import { getIntakeCompleteness, isValidCategory, monthsFromStatementText } from "../../../../lib/intake";
import { redactPii, scanPromptInjection, tokenizePii } from "../../../../lib/guardrails";
import {
  applications,
  documentTextBoxesById,
  documentTextById,
  recordAudit,
  spreadingResultsByApplication,
  uploadedDocuments,
} from "../../../../lib/store";
import { processPdf } from "../../../../lib/pdf-processing";
import type { PdfTextBox, UploadedDocument } from "../../../../lib/types";

export const runtime = "nodejs";

const maxFileSize = 12 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data with a PDF file." }, { status: 400 });
  }
  const applicationId = form.get("applicationId");
  const category = form.get("category");
  const file = form.get("file");
  if (
    typeof applicationId !== "string" ||
    !applicationId ||
    !isValidCategory(category) ||
    !(file instanceof File)
  ) {
    return Response.json(
      { error: "applicationId, category (bank/gstr1/gstr3b), and file are required." },
      { status: 400 },
    );
  }
  const application = applications.find(({ id }) => id === applicationId);
  if (!application) return Response.json({ error: "Application not found." }, { status: 404 });
  if (application.status !== "pending_docs") {
    return Response.json({ error: "Documents can be uploaded only after the RM accepts the application and before RM verification." }, { status: 409 });
  }
  if (file.size === 0 || file.size > maxFileSize) {
    return Response.json({ error: "PDF must be between 1 byte and 12 MB." }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    recordAudit({
      category: "intake-check",
      event: "Rejected upload that did not contain a valid PDF signature",
      userRole: "Intake Rule Engine",
      applicationId,
      details: { fileName: file.name.slice(0, 180) },
    });
    return Response.json({ error: "The uploaded file is not a valid PDF." }, { status: 415 });
  }

  let processed: Awaited<ReturnType<typeof processPdf>>;
  try {
    processed = await processPdf(bytes);
  } catch (cause: unknown) {
    console.error(
      "PDF text/OCR processing failed:",
      cause instanceof Error ? cause.message : "Unknown parser error",
    );
    recordAudit({
      category: "intake-check",
      event: "Rejected PDF after local text/OCR processing failed",
      userRole: "Intake Rule Engine",
      applicationId,
      details: { fileName: file.name.slice(0, 180) },
    });
    return Response.json(
      {
        error: cause instanceof Error
          ? `This PDF could not be processed locally: ${cause.message}`
          : "This PDF could not be processed locally.",
      },
      { status: 422 },
    );
  }
  if (processed.text.trim().length < 40) {
    recordAudit({
      category: "intake-check",
      event: "Rejected PDF with insufficient searchable statement text",
      userRole: "Intake Rule Engine",
      applicationId,
      details: { fileName: file.name.slice(0, 180) },
    });
    return Response.json(
      { error: "No usable text was found after local OCR. Check the scan quality and try again." },
      { status: 422 },
    );
  }

  const injection = scanPromptInjection(processed.text);
  if (injection) {
    recordAudit({
      category: "prompt-injection-blocked",
      event: `Blocked uploaded PDF after prompt-injection scan (${injection})`,
      userRole: "Security Middleware",
      applicationId,
      details: { fileName: file.name.slice(0, 180), reason: injection },
    });
    return Response.json(
      { error: "The uploaded statement was blocked by the security scan. Please request a clean copy." },
      { status: 422 },
    );
  }

  const safeText = tokenizePii(processed.text, applicationId, "Intake Security");
  const safeBoxes: PdfTextBox[] = processed.boxes.map((box) => ({
    ...box,
    text: redactPii(box.text),
  }));
  const id = crypto.randomUUID();
  const document: UploadedDocument = {
    id,
    applicationId,
    category,
    fileName: file.name.slice(0, 180),
    pageCount: processed.pageCount,
    coveredMonths: monthsFromStatementText(safeText.text),
    ocrApplied: processed.ocrApplied,
    uploadedAt: new Date().toISOString(),
    textAvailable: true,
  };
  uploadedDocuments.push(document);
  spreadingResultsByApplication.delete(application.id);
  documentTextById.set(id, safeText.text);
  documentTextBoxesById.set(id, safeBoxes);
  const completeness = getIntakeCompleteness(applicationId);
  recordAudit({
    category: "intake-check",
    event: `Uploaded and validated ${category} statement PDF`,
    userRole: "Intake Rule Engine",
    applicationId,
    details: {
      fileName: document.fileName,
      pageCount: document.pageCount,
      monthsFound: document.coveredMonths.length,
      piiTokenCount: safeText.tokenCount,
      ocrApplied: document.ocrApplied,
    },
  });
  return Response.json({
    document,
    completeness,
    processing: { ocrApplied: document.ocrApplied, textBoxCount: safeBoxes.length },
  });
}
