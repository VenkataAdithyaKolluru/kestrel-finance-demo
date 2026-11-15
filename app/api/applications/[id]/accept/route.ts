import { applications, recordAudit } from "../../../../../lib/store";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const { id } = await context.params;
  const application = applications.find((item) => item.id === id);
  if (!application) return Response.json({ error: "Application not found." }, { status: 404 });
  if (application.status !== "intake") {
    return Response.json({ error: "Only a new application awaiting RM acceptance can be accepted." }, { status: 409 });
  }

  application.status = "pending_docs";
  recordAudit({
    category: "human-signoff",
    event: `Relationship Manager accepted ${application.id} and requested supporting documents`,
    userRole: "Relationship Manager",
    applicationId: application.id,
    details: { nextAction: "Upload bank, GSTR-1, and GSTR-3B statements" },
  });
  return Response.json({ application });
}
