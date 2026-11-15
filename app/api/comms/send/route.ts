import { containsCreditRecommendation } from "../../../../lib/guardrails";
import { isRecord } from "../../../../lib/request";
import { applications, recordAudit } from "../../../../lib/store";
import {
  canCommunicateForApplication,
  getDemoPersona,
  isCommunicationReason,
  isPersona,
  isReasonAvailableForPersona,
} from "../../../../lib/communications";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (
    !isRecord(body) ||
    !isPersona(body.stage) ||
    !isCommunicationReason(body.reason) ||
    typeof body.recipient !== "string" ||
    typeof body.email !== "string" ||
    body.criticVerified !== true
  ) {
    return Response.json({ error: "A verified draft, recipient, workspace, and communication reason are required." }, { status: 400 });
  }

  const stage = body.stage;
  const reason = body.reason;
  if (getDemoPersona(request) !== stage) {
    return Response.json({ error: "The active demo workspace does not match this communication request." }, { status: 403 });
  }
  if (!isReasonAvailableForPersona(stage, reason)) {
    return Response.json({ error: "That communication reason is not available in this workspace." }, { status: 400 });
  }
  const recipient = body.recipient.trim().toLowerCase();
  if (
    recipient.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@demo\.kestrelfinance\.test$/.test(recipient)
  ) {
    return Response.json({ error: "Demo sends are limited to addresses in @demo.kestrelfinance.test." }, { status: 400 });
  }
  const email = body.email.trim();
  if (email.length < 20 || email.length > 10000) {
    return Response.json({ error: "The draft must be between 20 and 10,000 characters." }, { status: 400 });
  }
  if (containsCreditRecommendation(email)) {
    return Response.json({ error: "The Critic blocked this draft because it contains prohibited credit recommendation language." }, { status: 422 });
  }

  const applicationId = typeof body.applicationId === "string" ? body.applicationId : undefined;
  if (stage !== "owner" && !applicationId) {
    return Response.json({ error: "applicationId is required for customer communication." }, { status: 400 });
  }
  const application = applicationId ? applications.find(({ id }) => id === applicationId) : undefined;
  if (applicationId && !application) {
    return Response.json({ error: "Application not found." }, { status: 404 });
  }
  if (
    application &&
    stage !== "owner" &&
    !canCommunicateForApplication(stage, application.status)
  ) {
    return Response.json({ error: "This application is outside the active workspace's communication queue." }, { status: 409 });
  }
  if (reason === "decision-outcome" && !application?.decision) {
    return Response.json({ error: "A decision outcome can be sent only after a human decision is recorded." }, { status: 409 });
  }

  const audit = recordAudit({
    category: "communication-simulated",
    event: `Simulated ${stage} ${reason} email to demo recipient`,
    userRole: stage,
    applicationId,
    details: { reason, deliveryMode: "simulated-only", recipientDomain: "demo.kestrelfinance.test" },
  });
  return Response.json({
    simulated: true,
    sentAt: audit.timestamp,
    auditId: audit.id,
    message: "Demo email recorded in the audit ledger. No email provider was contacted.",
  });
}
