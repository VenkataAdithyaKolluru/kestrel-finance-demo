import { applications, documentTextById, mockSpreadingData, recordAudit, recordCost, spreadingResultsByApplication, systemConfig, uploadedDocuments } from "../../../lib/store";
import { isRecord } from "../../../lib/request";
import { containsCreditRecommendation, scanPromptInjection, tokenizePii } from "../../../lib/guardrails";
import { citationsForSpreading } from "../../../lib/pdf-citations";
import type { ExtractionResult, SpreadingData } from "../../../lib/types";

export async function POST(request: Request): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));

  let applicationId: string;
  try {
    const body: unknown = await request.json();
    if (!isRecord(body) || typeof body.applicationId !== "string" || !body.applicationId) {
      return Response.json({ error: "applicationId is required." }, { status: 400 });
    }
    applicationId = body.applicationId;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const application = applications.find(({ id }) => id === applicationId);
  if (!application) return Response.json({ error: "Application not found." }, { status: 404 });
  if (application.status !== "spreading") {
    return Response.json(
      { error: application.status === "decided"
        ? "This dossier is locked after a recorded decision."
        : "The application must pass intake before extraction." },
      { status: 409 },
    );
  }

  for (const document of uploadedDocuments.filter((item) => item.applicationId === applicationId)) {
    const text = documentTextById.get(document.id) ?? "";
    const injection = scanPromptInjection(text);
    if (injection) {
      recordAudit({
        category: "prompt-injection-blocked",
        event: `Blocked agent call on document ${document.fileName}`,
        userRole: "Security Middleware",
        applicationId,
        details: { reason: injection },
      });
      return Response.json({ error: "Agent request blocked by document security scan." }, { status: 422 });
    }
    tokenizePii(text, applicationId, "Extraction Security");
  }

  const timestamp = new Date().toISOString();
  const tokens = 920;
  const forceFallback = systemConfig.activeModel === "manual-review";
  const extracted: SpreadingData = {
    ...mockSpreadingData,
    citations: citationsForSpreading(applicationId, mockSpreadingData),
  };
  const citationsValid = Object.values(extracted.citations ?? {}).every(
    ({ page, x, y, width, height }) =>
      Number.isInteger(page) &&
      page > 0 &&
      page <= 100 &&
      [x, y, width, height].every(Number.isFinite) &&
      x >= 0 &&
      y >= 0 &&
      width > 0 &&
      height > 0 &&
      x + width <= 1.05 &&
      y + height <= 1.05,
  );
  const mathValid =
    extracted.bankCreditsINR - extracted.bankDebitsINR === extracted.bankNetMovementINR;
  const outputText = JSON.stringify(extracted);
  const safeOutput = !containsCreditRecommendation(outputText);
  const criticVerified = mathValid && citationsValid && safeOutput;
  const fallbackUsed = forceFallback || !criticVerified;
  const model = fallbackUsed ? systemConfig.fallbackModel : systemConfig.activeModel;

  recordCost({
    applicationId,
    actionName: "Statement extraction",
    microAction: "extraction",
    tokens,
    costINR: Number(((tokens / 1000) * (fallbackUsed
      ? systemConfig.secondaryCostPer1kTokensINR
      : systemConfig.unitCostPer1kTokensINR)).toFixed(4)),
    timestamp,
  });
  recordCost({
    applicationId,
    actionName: "Critic verification",
    microAction: "critic",
    tokens: 180,
    costINR: Number(((180 / 1000) * systemConfig.unitCostPer1kTokensINR).toFixed(4)),
    timestamp,
  });
  recordAudit({
    category: fallbackUsed ? "model-fallback" : "agent-call",
    event: fallbackUsed
      ? `Primary model routed to ${model} for ${applicationId}`
      : `Extraction completed with ${model}`,
    userRole: "Orchestration Gateway",
    applicationId,
    details: { primaryModel: systemConfig.activeModel, selectedModel: model },
    timestamp,
  });

  if (!criticVerified) {
    recordAudit({
      category: "critic-intervention",
      event: "Critic blocked output: math, citation, or prohibited-language check failed",
      userRole: "Critic Agent",
      applicationId,
      timestamp,
    });
  } else if (!forceFallback) {
    recordAudit({
      category: "critic-verified",
      event: "Math Verified by Critic; matched PDF text/OCR citations have valid page coordinates and prohibited-language checks passed",
      userRole: "Critic Agent",
      applicationId,
      timestamp,
      details: { citedFields: Object.keys(extracted.citations ?? {}).length },
    });
  }

  const fallbackData: SpreadingData = {
    period: "Fallback / manual review",
    bankCreditsINR: 1000000,
    bankDebitsINR: 900000,
    bankNetMovementINR: 100000,
    gstTurnoverINR: 950000,
    gstVariancePercent: 5,
    monthsCovered: 12,
    citations: {},
  };
  const response: ExtractionResult = {
    ...(criticVerified && !forceFallback ? extracted : fallbackData),
    fallbackUsed,
    model,
    criticVerified: criticVerified && !forceFallback,
    agentConfidencePercent: criticVerified && !forceFallback ? 96 : 45,
    criticConfidencePercent: criticVerified ? 100 : 0,
    ...(forceFallback
      ? { fallbackReason: "Primary model set to manual-review by Owner policy." }
      : !criticVerified
        ? { fallbackReason: "Critic did not accept the primary output; safe fallback figures routed for manual review." }
        : {}),
  };
  spreadingResultsByApplication.set(applicationId, response);
  recordAudit({
    category: criticVerified ? "critic-verified" : "critic-intervention",
    event: criticVerified
      ? `Extraction review ready; analyst confirmation required for ${applicationId}`
      : `Extraction routed to manual review; analyst confirmation required for ${applicationId}`,
    userRole: "Critic Agent",
    applicationId,
    details: {
      agentConfidencePercent: response.agentConfidencePercent,
      criticConfidencePercent: response.criticConfidencePercent,
      analystAdvanceRequired: true,
    },
  });
  return Response.json(response);
}
