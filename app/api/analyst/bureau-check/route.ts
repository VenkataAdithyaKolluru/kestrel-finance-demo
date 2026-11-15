import { applications, recordAudit } from "../../../../lib/store";
import { isRecord } from "../../../../lib/request";
import { createDemoBureauScore } from "../../../../lib/demo-customer-profile";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.applicationId !== "string" || !body.applicationId.trim()) {
    return Response.json({ error: "applicationId is required." }, { status: 400 });
  }

  const application = applications.find(({ id }) => id === body.applicationId);
  if (!application) return Response.json({ error: "Application not found." }, { status: 404 });
  if (application.status !== "spreading") {
    return Response.json({ error: "A bureau review is available only during Analyst review." }, { status: 409 });
  }

  application.demoBureauScore = createDemoBureauScore(application.id);
  application.demoBureauCheckedAt = new Date().toISOString();
  recordAudit({
    category: "agent-call",
    event: `Synthetic bureau score checked for ${application.id}`,
    userRole: "Analyst",
    applicationId: application.id,
    details: {
      score: application.demoBureauScore,
      source: "synthetic-demo-only",
      subject: "promoter",
    },
  });

  return Response.json({
    application,
    source: "synthetic-demo-only",
    message: "Synthetic sample score created. No CIBIL or other credit bureau was queried.",
  });
}
