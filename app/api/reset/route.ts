import { resetStore, recordAudit } from "../../../lib/store";

export async function POST(): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  resetStore();
  recordAudit({
    category: "manual-override",
    event: "Demo instance data reset to synthetic seed data",
    userRole: "Demo Operator",
  });
  return Response.json({ ok: true });
}
