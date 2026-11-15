import { applications, spreadingResultsByApplication, summariesByApplication, systemConfig } from "../../../../lib/store";
import { getDemoPersona } from "../../../../lib/communications";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const { id } = await context.params;
  const application = applications.find((item) => item.id === id);
  if (!application) return Response.json({ error: "Application not found." }, { status: 404 });
  const persona = getDemoPersona(_request);
  if (
    persona === "credit-manager" &&
    application.status !== "signoff" &&
    application.status !== "decided"
  ) {
    return Response.json({ error: "Application is not available in the Credit Manager workflow yet." }, { status: 404 });
  }
  return Response.json({
    application,
    spreading: spreadingResultsByApplication.get(id) ?? null,
    config: systemConfig,
    summary: summariesByApplication.get(id) ?? null,
    locked: application.status === "decided",
  });
}
