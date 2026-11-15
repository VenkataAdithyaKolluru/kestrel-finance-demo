import { applications, recordAudit } from "../../../lib/store";
import { isRecord } from "../../../lib/request";

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
    typeof body.officerName !== "string" ||
    !body.officerName.trim() ||
    typeof body.password !== "string" ||
    !body.password.trim() ||
    body.humanVerified !== true
  ) {
    return Response.json({ error: "Application, credit officer name, password, and human confirmation are required." }, { status: 400 });
  }
  const application = applications.find(({ id }) => id === body.applicationId);
  if (!application) return Response.json({ error: "Application not found." }, { status: 404 });
  if (application.status !== "decided" || application.decision !== "Approve") {
    return Response.json({ error: "Only an approved application can be disbursed." }, { status: 409 });
  }
  if (application.disbursedAt) {
    return Response.json({ error: "Funds have already been recorded as disbursed for this application." }, { status: 409 });
  }

  application.disbursedAt = new Date().toISOString();
  application.disbursedBy = body.officerName.trim();
  recordAudit({
    category: "human-signoff",
    event: `Demo funds disbursed for ${application.id} by ${application.disbursedBy}`,
    userRole: "Credit Officer",
    applicationId: application.id,
    details: { passwordAcceptedForDemo: true, authenticationIsSynthetic: true },
  });
  return Response.json({ application, disbursed: true });
}
