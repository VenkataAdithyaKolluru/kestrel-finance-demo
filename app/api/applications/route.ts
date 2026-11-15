import { applications } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return Response.json(applications);
}
