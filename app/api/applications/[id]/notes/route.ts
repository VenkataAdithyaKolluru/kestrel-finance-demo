import { applications, recordAudit } from "../../../../../lib/store";
import { isRecord } from "../../../../../lib/request";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const { id } = await context.params;
  const application = applications.find((item) => item.id === id);
  if (!application) return Response.json({ error: "Application not found." }, { status: 404 });
  if (application.status !== "spreading") {
    return Response.json({ error: "Analyst notes can be updated only during Analyst review." }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.notes !== "string" || body.notes.trim().length > 2000) {
    return Response.json({ error: "notes must be a string of at most 2,000 characters." }, { status: 400 });
  }
  application.analystNotes = body.notes.trim();
  recordAudit({
    category: "manual-override",
    event: `Analyst notes updated for ${application.id}`,
    userRole: "Analyst",
    applicationId: application.id,
    details: { characterCount: application.analystNotes.length },
  });
  return Response.json({ application });
}
