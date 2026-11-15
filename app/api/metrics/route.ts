import { applications } from "../../../lib/store";
import type { ExecutiveMetrics } from "../../../lib/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const completed = applications
    .filter((application) => application.decidedAt && !application.withdrawn)
    .map((application) =>
      (new Date(application.decidedAt!).getTime() - new Date(application.createdAt).getTime()) /
      (24 * 60 * 60 * 1000),
    )
    .sort((a, b) => a - b);
  const middle = Math.floor(completed.length / 2);
  const medianCycleDays = completed.length
    ? Number((completed.length % 2 ? completed[middle] : (completed[middle - 1] + completed[middle]) / 2).toFixed(1))
    : 0;
  const withdrawn = applications.filter(({ withdrawn }) => withdrawn).length;
  const metrics: ExecutiveMetrics = {
    medianCycleDays,
    cycleBaselineDays: 18,
    withdrawalRatePercent: applications.length ? Number(((withdrawn / applications.length) * 100).toFixed(1)) : 0,
    withdrawalBaselinePercent: 22,
    manualMinutesSaved: applications.filter(({ status }) => status !== "intake" && status !== "pending_docs").length * 210,
    totalApplications: applications.length,
  };
  return Response.json(metrics);
}
