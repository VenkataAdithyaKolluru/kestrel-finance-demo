import { applications, recordAudit } from "../../../../lib/store";
import { createDemoCustomerProfile } from "../../../../lib/demo-customer-profile";
import { isRecord } from "../../../../lib/request";
import type { LoanApplication } from "../../../../lib/types";

export async function POST(request: Request): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isRecord(body)) {
    return Response.json({ error: "Applicant name and requested loan amount are required." }, { status: 400 });
  }

  const applicantName = typeof body.applicantName === "string" ? body.applicantName.trim() : "";
  const loanAmount = body.loanAmount;
  if (applicantName.length < 2 || applicantName.length > 120) {
    return Response.json({ error: "Applicant name must be between 2 and 120 characters." }, { status: 400 });
  }
  if (typeof loanAmount !== "number" || !Number.isFinite(loanAmount) || loanAmount <= 0 || loanAmount > 1_000_000_000_000) {
    return Response.json({ error: "Requested amount must be greater than ₹0 and no more than ₹1,00,00,00,00,000." }, { status: 400 });
  }

  const year = new Date().getUTCFullYear();
  const prefix = `KF-${year}-`;
  const sequence = applications.reduce((max, application) => {
    if (!application.id.startsWith(prefix)) return max;
    const suffix = Number(application.id.slice(prefix.length));
    return Number.isInteger(suffix) ? Math.max(max, suffix) : max;
  }, 0) + 1;
  const applicationId = `${prefix}${String(sequence).padStart(3, "0")}`;
  const application: LoanApplication = {
    id: applicationId,
    applicantName,
    loanAmount,
    customerProfile: createDemoCustomerProfile(applicationId, applicantName),
    status: "intake",
    createdAt: new Date().toISOString(),
  };
  applications.unshift(application);
  recordAudit({
    category: "manual-override",
    event: `Created demo loan application ${application.id}`,
    userRole: "Relationship Manager",
    applicationId: application.id,
    details: { loanAmount },
  });
  return Response.json({ application }, { status: 201 });
}
