import {
  applications,
  documentTextById,
  documentTextBoxesById,
  piiTokenVault,
  recordAudit,
  recordCost,
  requiredMonths,
  spreadingResultsByApplication,
  uploadedDocuments,
} from "../../../../lib/store";
import { getIntakeCompleteness } from "../../../../lib/intake";
import { isRecord } from "../../../../lib/request";
import type { DocumentCategory } from "../../../../lib/types";

const categories: DocumentCategory[] = ["bank", "gstr1", "gstr3b"];

export async function POST(request: Request): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.applicationId !== "string") {
    return Response.json({ error: "applicationId is required." }, { status: 400 });
  }
  const application = applications.find(({ id }) => id === body.applicationId);
  if (!application) return Response.json({ error: "Application not found." }, { status: 404 });
  if (application.status !== "pending_docs") {
    return Response.json({ error: "Accept this application before loading a sample document packet." }, { status: 409 });
  }

  const previousDocuments = uploadedDocuments.filter((document) => document.applicationId === application.id);
  for (const document of previousDocuments) {
    const storedText = [
      documentTextById.get(document.id) ?? "",
      ...(documentTextBoxesById.get(document.id) ?? []).map((box) => box.text),
    ];
    for (const text of storedText) {
      for (const [token] of text.matchAll(/\[PII_[0-9a-f]{8}\]/g)) {
        piiTokenVault.delete(token);
      }
    }
    documentTextById.delete(document.id);
    documentTextBoxesById.delete(document.id);
  }
  spreadingResultsByApplication.delete(application.id);
  uploadedDocuments.splice(
    0,
    uploadedDocuments.length,
    ...uploadedDocuments.filter((document) => document.applicationId !== application.id),
  );
  const now = new Date().toISOString();
  for (const category of categories) {
    uploadedDocuments.push({
      id: crypto.randomUUID(),
      applicationId: application.id,
      category,
      fileName: `synthetic-${category}-12-months.pdf`,
      pageCount: 12,
      coveredMonths: [...requiredMonths],
      ocrApplied: false,
      uploadedAt: now,
      textAvailable: true,
    });
  }
  recordAudit({
    category: "intake-check",
    event: `Loaded synthetic 12-month statement packet for ${application.id}`,
    userRole: "Intake Demo Fixture",
    applicationId: application.id,
    details: { months: 12, documentCategories: categories },
  });
  recordAudit({
    category: "critic-verified",
    event: `Critic verified synthetic sample coverage metadata for ${application.id}; RM verification is still required`,
    userRole: "Critic Agent",
    applicationId: application.id,
    details: { months: 12, documentCategories: categories, syntheticFixture: true },
  });
  recordCost({
    applicationId: application.id,
    actionName: "Intake rules",
    microAction: "intake",
    tokens: 0,
    costINR: 0,
  });
  return Response.json({
    ok: true,
    application,
    completeness: getIntakeCompleteness(application.id),
    months: requiredMonths,
    categories,
  });
}
