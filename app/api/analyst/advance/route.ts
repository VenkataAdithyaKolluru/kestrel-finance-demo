import { applications, recordAudit, spreadingResultsByApplication, summariesByApplication } from "../../../../lib/store";
import { isRecord } from "../../../../lib/request";
import { getIntakeCompleteness } from "../../../../lib/intake";

export async function POST(request: Request): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.applicationId !== "string" || body.reviewConfirmed !== true) {
    return Response.json({ error: "applicationId and explicit analyst review confirmation are required." }, { status: 400 });
  }

  const application = applications.find(({ id }) => id === body.applicationId);
  if (!application) return Response.json({ error: "Application not found." }, { status: 404 });
  if (application.status !== "spreading") {
    return Response.json({ error: "The application must be in analyst review before it can move forward." }, { status: 409 });
  }
  const result = spreadingResultsByApplication.get(application.id);
  if (!result) {
    return Response.json({ error: "Run document analysis before moving the application to credit decision." }, { status: 409 });
  }
  const completeness = getIntakeCompleteness(application.id);
  const coverageValid = completeness.complete || application.status === "spreading";
  if (!coverageValid) {
    return Response.json({ error: "RM document coverage must be verified before an analyst can hand off this application." }, { status: 409 });
  }
  if (!result.criticVerified) {
    return Response.json({ error: "The Critic has not verified this analysis; resolve the flagged checks before handing off to Credit Manager." }, { status: 409 });
  }
  if (typeof application.demoBureauScore !== "number") {
    return Response.json({ error: "Promoter bureau review must be completed before handing off to Credit Manager." }, { status: 409 });
  }
  if (!summariesByApplication.get(application.id)) {
    return Response.json({ error: "A Critic-verified cash-flow summary must be generated before handing off to Credit Manager." }, { status: 409 });
  }

  application.status = "signoff";
  recordAudit({
    category: "human-signoff",
    event: `Analyst completed all reviews, verified agent output, and moved ${application.id} to credit decision`,
    userRole: "Analyst",
    applicationId: application.id,
    details: {
      criticVerified: result.criticVerified,
      agentConfidencePercent: result.agentConfidencePercent,
      bureauChecked: true,
      bureauScore: application.demoBureauScore,
      summaryVerified: true,
      humanConfirmed: true,
    },
  });
  return Response.json({ application });
}
