import { applications, finOpsLedger } from "../../../lib/store";
import type { MicroAction } from "../../../lib/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const byApplication = applications.map((application) => {
    const entries = finOpsLedger.filter((entry) => entry.applicationId === application.id);
    return {
      applicationId: application.id,
      applicantName: application.applicantName,
      costINR: Number(entries.reduce((sum, entry) => sum + entry.costINR, 0).toFixed(4)),
      actions: Object.fromEntries(
        (["intake", "extraction", "critic", "summary", "communications"] as MicroAction[]).map((action) => [
          action,
          Number(entries.filter((entry) => entry.microAction === action).reduce((sum, entry) => sum + entry.costINR, 0).toFixed(4)),
        ]),
      ),
    };
  });
  return Response.json({ entries: finOpsLedger, byApplication });
}
