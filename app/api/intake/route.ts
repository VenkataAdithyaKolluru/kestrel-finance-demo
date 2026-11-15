import { applications, recordAudit, recordCost, systemConfig } from "../../../lib/store";
import { isRecord } from "../../../lib/request";
import { getIntakeCompleteness } from "../../../lib/intake";

export async function POST(request: Request): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!isRecord(body) || typeof body.applicationId !== "string" || body.applicationId.trim() === "") {
    return Response.json({ error: "applicationId is required." }, { status: 400 });
  }

  const application = applications.find(({ id }) => id === body.applicationId);
  if (!application) {
    return Response.json({ error: "Application not found." }, { status: 404 });
  }
  if (application.status !== "pending_docs") {
    return Response.json({ error: "Only an RM-accepted application collecting documents can be verified." }, { status: 409 });
  }

  const completeness = getIntakeCompleteness(application.id);
  if (completeness.complete) application.status = "spreading";
  recordAudit({
    category: "intake-check",
    event: completeness.complete
      ? `12-month document coverage verified for ${application.id}`
      : `Intake flagged missing statement periods for ${application.id}`,
    userRole: "Intake Rule Engine",
    applicationId: application.id,
    details: {
      complete: completeness.complete,
      missingCategories: completeness.missingCategories,
      missingMonthCount: Object.values(completeness.missingMonths).flat().length,
    },
  });
  recordAudit({
    category: "critic-verified",
    event: completeness.complete
      ? `Critic verified intake coverage checks for ${application.id}`
      : `Critic verified missing-period findings and blocked analyst handoff for ${application.id}`,
    userRole: "Critic Agent",
    applicationId: application.id,
    details: {
      expectedCategories: 3,
      missingMonthCount: Object.values(completeness.missingMonths).flat().length,
      handoffAllowed: completeness.complete,
    },
  });
  recordCost({
    applicationId: application.id,
    actionName: "Intake rules",
    microAction: "intake",
    tokens: 0,
    costINR: 0,
  });
  return Response.json({ application, completeness });
}
