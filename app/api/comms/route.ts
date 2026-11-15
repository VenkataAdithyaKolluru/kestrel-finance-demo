import {
  applications,
  auditLedger,
  finOpsLedger,
  recordAudit,
  recordCost,
  systemConfig,
} from "../../../lib/store";
import { getIntakeCompleteness } from "../../../lib/intake";
import { containsCreditRecommendation } from "../../../lib/guardrails";
import { isRecord } from "../../../lib/request";
import {
  canCommunicateForApplication,
  getDemoPersona,
  isCommunicationReason,
  isPersona,
  isReasonAvailableForPersona,
} from "../../../lib/communications";
import type { AgentCriticResult, CommunicationReason, Persona } from "../../../lib/types";

function makeCritic(email: string): AgentCriticResult {
  return {
    verified: !containsCreditRecommendation(email),
    confidencePercent: 100,
    checks: [
      "Draft is editable and tied to the selected communication purpose.",
      "No prohibited credit recommendation language is present.",
      "Customer-facing decision language reflects only a recorded human decision.",
    ],
  };
}

function recordCommunicationCost(applicationId: string): void {
  const tokens = 160;
  recordCost({
    applicationId,
    actionName: "Communication draft review",
    microAction: "communications",
    tokens,
    costINR: Number(((tokens / 1000) * systemConfig.unitCostPer1kTokensINR).toFixed(4)),
  });
}

export async function POST(request: Request): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 500));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isRecord(body) || !isPersona(body.stage) || !isCommunicationReason(body.reason)) {
    return Response.json({ error: "A valid workspace and communication reason are required." }, { status: 400 });
  }

  const stage = body.stage;
  const reason = body.reason;
  if (getDemoPersona(request) !== stage) {
    return Response.json({ error: "The active demo workspace does not match this communication request." }, { status: 403 });
  }
  if (!isReasonAvailableForPersona(stage, reason)) {
    return Response.json({ error: "That communication reason is not available in this workspace." }, { status: 400 });
  }
  const action = body.action === undefined ? "draft" : body.action;
  if (action !== "draft" && action !== "verify") {
    return Response.json({ error: "Unsupported communication action." }, { status: 400 });
  }

  const applicationId = typeof body.applicationId === "string" ? body.applicationId : "";
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
    return Response.json({ error: "A decision outcome can be drafted only after a human decision is recorded." }, { status: 409 });
  }

  const completeness = application ? getIntakeCompleteness(application.id) : null;
  const missing = completeness
    ? (Object.entries(completeness.missingMonths) as Array<[string, string[]]>)
      .filter(([, months]) => months.length > 0)
      .map(([category, months]) => `${category.toUpperCase()}: ${months.join(", ")}`)
    : [];
  const details = missing.length ? missing.join("\n") : "Please confirm the required statement periods and supporting details.";

  let email: string;
  if (action === "verify") {
    if (typeof body.email !== "string" || body.email.trim().length < 20 || body.email.length > 10000) {
      return Response.json({ error: "Enter a draft between 20 and 10,000 characters to review." }, { status: 400 });
    }
    email = body.email.trim();
  } else {
    const greeting = application
      ? systemConfig.tone === "warm"
        ? `Dear ${application.applicantName},\n\nWe hope you are doing well.`
        : `Dear ${application.applicantName},`
      : "Hello Kestrel Finance team,";
    const subjectLine: Record<CommunicationReason, string> = {
      "missing-documents": `Documents required for ${application?.id ?? "your application"}`,
      "intake-received": `Application received · ${application?.id ?? ""}`,
      "additional-information": `Information request · ${application?.id ?? ""}`,
      "review-update": `Review update · ${application?.id ?? ""}`,
      "statement-clarification": `Statement clarification · ${application?.id ?? ""}`,
      "decision-outcome": `Decision update · ${application?.id ?? ""}`,
      "next-steps": `Review next steps · ${application?.id ?? ""}`,
      "governance-summary": "Kestrel Finance demo governance update",
      "audit-summary": "Kestrel Finance demo audit summary",
      "cost-summary": "Kestrel Finance demo cost summary",
    };

    let message: string;
    switch (reason) {
      case "missing-documents":
        message = completeness?.complete
          ? "Our current checklist shows the required 12-month bank, GSTR-1, and GSTR-3B coverage. Please confirm whether any updated statements are available."
          : `To continue the review, please provide the following statement periods:\n\n${details}\n\nWe will re-check the reporting period when the statements are received.`;
        break;
      case "intake-received":
        message = "We have received your application and will review the supporting documents. We will contact you if further information is needed.";
        break;
      case "additional-information":
        message = "Please reply with the specific information requested by your Relationship Manager. This draft is a starting point; add the exact question and requested period before sending.";
        break;
      case "review-update":
        message = stage === "credit-manager"
          ? application?.decision
            ? `A human Credit Manager recorded a ${application.decision.toLowerCase()} decision for this application. The team will share the applicable next steps through the official channel.`
            : "Your application is with the Credit Manager for human review. No decision has been recorded or communicated by this status update."
          : "Your application is being reviewed. We will contact you if clarification or additional documents are required. No credit decision is communicated by this update.";
        break;
      case "statement-clarification":
        message = `Please clarify the following statement coverage or reporting periods so our team can complete its review:\n\n${details}\n\nThis request is for factual clarification only.`;
        break;
      case "decision-outcome":
        message = application?.decision
          ? `A human Credit Manager recorded a ${application.decision.toLowerCase()} decision for this application. Please contact the Kestrel Finance team through the official channel to discuss next steps.`
          : "The application is still awaiting a human Credit Manager decision. This draft does not communicate an outcome.";
        break;
      case "next-steps":
        message = application?.decision === "Approve"
          ? "The approval decision has been recorded by a human Credit Manager. The Credit Officer will confirm any applicable next steps through the official channel."
          : "Please contact the Kestrel Finance team through the official channel for the next update. Do not treat this message as a new decision or a disbursement confirmation.";
        break;
      case "governance-summary":
        message = `This is a demo governance update. The workspace currently contains ${applications.length} synthetic application records. No real customer information, production model, or credit decision is involved.`;
        break;
      case "audit-summary":
        message = `The in-memory demo audit ledger currently contains ${auditLedger.length} events. These records are illustrative, are not tamper-proof, and are cleared when demo data is reset.`;
        break;
      case "cost-summary":
        message = `The demo FinOps ledger currently contains ${finOpsLedger.length} simulated actions. Token counts and INR costs are estimates from configurable demo pricing, not vendor telemetry or invoices.`;
        break;
    }

    email = `Subject: ${subjectLine[reason]}\n\n${greeting}\n\n${message}\n\nRegards,\nKestrel Finance ${stage === "owner" ? "Operations" : stage === "rm" ? "Relationship Management" : stage === "analyst" ? "Analyst" : "Credit"} Team`;
  }

  if (stage !== "owner" && application) recordCommunicationCost(application.id);
  const critic = makeCritic(email);
  recordAudit({
    category: critic.verified ? "critic-verified" : "critic-intervention",
    event: `${critic.verified ? "Critic reviewed" : "Critic blocked"} ${stage} ${reason} communication${application ? ` for ${application.id}` : ""}`,
    userRole: "Critic Agent",
    applicationId: application?.id,
    details: { reason, passedChecks: critic.verified ? critic.checks.length : 0 },
  });

  if (!critic.verified && action === "draft") {
    return Response.json({ error: "Draft blocked by the Critic Agent.", critic }, { status: 422 });
  }
  return Response.json({ email, reason, critic });
}
