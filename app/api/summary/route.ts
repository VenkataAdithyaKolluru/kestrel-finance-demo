import { applications, mockSpreadingData, recordAudit, recordCost, spreadingResultsByApplication, summariesByApplication, systemConfig } from "../../../lib/store";
import { isRecord } from "../../../lib/request";
import { containsCreditRecommendation } from "../../../lib/guardrails";
import type { SummaryResult } from "../../../lib/types";

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
  if (application.status !== "spreading") {
    return Response.json({ error: "A cash-flow summary is available only during Analyst review." }, { status: 409 });
  }

  const data = spreadingResultsByApplication.get(application.id) ?? mockSpreadingData;
  const netRatio = data.bankCreditsINR
    ? Number(((data.bankNetMovementINR / data.bankCreditsINR) * 100).toFixed(1))
    : 0;
  let summary =
    `${application.applicantName} recorded ${money(data.bankCreditsINR)} in bank credits and ${money(data.bankDebitsINR)} in debits during ${data.period}, resulting in net movement of ${money(data.bankNetMovementINR)}. Reported GST turnover was ${money(data.gstTurnoverINR)}, a ${data.gstVariancePercent.toFixed(1)}% variance against bank credits; net movement was ${netRatio}% of credits. Figures are synthetic demo data and describe cash-flow observations only.`;
  if (containsCreditRecommendation(summary)) {
    recordAudit({
      category: "critic-intervention",
      event: `Critic blocked prohibited recommendation language in summary for ${application.id}`,
      userRole: "Critic Agent",
      applicationId: application.id,
    });
    return Response.json({ error: "Summary blocked because it contains prohibited credit recommendation language." }, { status: 422 });
  }

  const tokens = 240;
  const costINR = Number(((tokens / 1000) * systemConfig.unitCostPer1kTokensINR).toFixed(4));
  recordCost({
    applicationId: application.id,
    actionName: "Cash-flow summary",
    microAction: "summary",
    tokens,
    costINR,
  });
  recordAudit({
    category: "critic-verified",
    event: `Critic verified factual cash-flow summary for ${application.id}`,
    userRole: "Critic Agent",
    applicationId: application.id,
    details: { model: systemConfig.activeModel, prohibitedRecommendationCheck: "passed", confidencePercent: 98 },
  });
  const result: SummaryResult = {
    summary,
    applicationId: application.id,
    generatedAt: new Date().toISOString(),
    model: systemConfig.activeModel,
    containsRecommendation: false,
    criticVerified: true,
    criticConfidencePercent: 98,
  };
  summariesByApplication.set(application.id, summary);
  return Response.json(result);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const applicationId = url.searchParams.get("applicationId");
  if (!applicationId) return Response.json({ summary: null, criticConfidencePercent: null });
  const summary = summariesByApplication.get(applicationId) ?? null;
  return Response.json({ summary, criticConfidencePercent: summary ? 98 : null });
}

function money(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}
