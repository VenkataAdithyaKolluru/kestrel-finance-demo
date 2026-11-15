import { getIntakeCompleteness } from "../../../../lib/intake";
import { applications } from "../../../../lib/store";
import { getDemoPersona } from "../../../../lib/communications";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const { id } = await context.params;
  const application = applications.find((item) => item.id === id);
  if (!application) {
    return Response.json({ error: "Application not found." }, { status: 404 });
  }
  const persona = getDemoPersona(_request);
  if (
    (persona === "analyst" && application.status !== "spreading") ||
    (persona === "credit-manager" && application.status !== "signoff" && application.status !== "decided") ||
    (persona === "rm" && application.status !== "intake" && application.status !== "pending_docs")
  ) {
    return Response.json({ error: "Application is not available in this role's current workflow." }, { status: 404 });
  }
  return Response.json(getIntakeCompleteness(id));
}
