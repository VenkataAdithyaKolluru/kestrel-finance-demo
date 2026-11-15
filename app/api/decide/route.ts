import { applications, recordAudit } from "../../../lib/store";
import { isRecord } from "../../../lib/request";
import type { CreditDecision } from "../../../lib/types";

function isDecision(value: unknown): value is CreditDecision {
  return value === "Approve" || value === "Decline";
}

export async function POST(request: Request): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (
    !isRecord(body) ||
    typeof body.applicationId !== "string" ||
    body.applicationId.trim() === "" ||
    !isDecision(body.decision) ||
    typeof body.signedBy !== "string" ||
    body.signedBy.trim() === "" ||
    typeof body.password !== "string" ||
    body.password.trim() === ""
  ) {
    return Response.json(
      { error: "applicationId, a valid decision, signedBy, and a non-empty demo password are required." },
      { status: 400 },
    );
  }

  const application = applications.find(({ id }) => id === body.applicationId);
  if (!application) {
    return Response.json({ error: "Application not found." }, { status: 404 });
  }
  if (application.status === "decided") {
    return Response.json({ error: "This dossier is locked after a recorded decision." }, { status: 409 });
  }
  if (application.status !== "signoff") {
    return Response.json(
      { error: "A human decision may be recorded only after the application reaches Pending Decision." },
      { status: 409 },
    );
  }

  application.status = "decided";
  application.decision = body.decision;
  application.signedBy = body.signedBy.trim();
  application.decidedAt = new Date().toISOString();
  if (body.decision === "Approve") {
    application.disbursedAt = application.decidedAt;
    application.disbursedBy = application.signedBy;
  }
  recordAudit({
    category: "human-signoff",
    event: `${body.decision} decision signed by ${body.signedBy.trim()} for ${application.id}`,
    userRole: "Credit Manager",
    applicationId: application.id,
    details: { demoPasswordProvided: true, autoDisbursedOnApproval: body.decision === "Approve" },
  });

  return Response.json({ application, decision: body.decision });
}
