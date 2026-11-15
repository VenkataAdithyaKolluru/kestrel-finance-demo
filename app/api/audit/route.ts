import { auditLedger } from "../../../lib/store";
import type { AuditCategory } from "../../../lib/types";

export const dynamic = "force-dynamic";

const categories: AuditCategory[] = [
  "intake-check", "agent-call", "communication-simulated", "pii-tokenized", "prompt-injection-blocked",
  "model-fallback", "critic-intervention", "critic-verified", "human-signoff",
  "manual-override", "config-change",
];

export async function GET(request: Request): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim().toLowerCase() ?? "";
  const category = searchParams.get("category") ?? "";
  if (category && !categories.includes(category as AuditCategory)) {
    return Response.json({ error: "Unknown audit category." }, { status: 400 });
  }
  const events = auditLedger.filter((entry) => {
    const matchesText =
      !query ||
      `${entry.event} ${entry.userRole} ${entry.applicationId ?? ""} ${JSON.stringify(entry.details ?? {})}`
        .toLowerCase()
        .includes(query);
    return matchesText && (!category || entry.category === category);
  });
  return Response.json(events);
}
