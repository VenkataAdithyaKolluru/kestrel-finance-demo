import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Persona } from "./lib/types";

const allowedRoles: Record<string, Partial<Record<string, Persona[]>>> = {
  "/api/applications": { GET: ["rm", "analyst", "credit-manager", "owner"] },
  "/api/applications/create": { POST: ["rm"] },
  "/api/applications/accept": { POST: ["rm"] },
  "/api/disburse": { POST: ["credit-manager"] },
  "/api/intake": { POST: ["rm"] },
  "/api/intake/upload": { POST: ["rm"] },
  "/api/intake/sample": { POST: ["rm"] },
  "/api/comms": { POST: ["rm", "analyst", "credit-manager", "owner"] },
  "/api/comms/send": { POST: ["rm", "analyst", "credit-manager", "owner"] },
  "/api/extract": { POST: ["analyst"] },
  "/api/analyst/bureau-check": { POST: ["analyst"] },
  "/api/analyst/advance": { POST: ["analyst"] },
  "/api/summary": { GET: ["analyst", "credit-manager", "owner"], POST: ["analyst"] },
  "/api/applications/notes": { POST: ["analyst"] },
  "/api/dossier": { GET: ["credit-manager", "owner"] },
  "/api/decide": { POST: ["credit-manager"] },
  "/api/config": { GET: ["owner"], POST: ["owner"] },
  "/api/finops": { GET: ["owner"] },
  "/api/audit": { GET: ["owner"] },
  "/api/metrics": { GET: ["owner"] },
};

function routePolicy(pathname: string): Partial<Record<string, Persona[]>> | undefined {
  const exact = allowedRoles[pathname];
  if (exact) return exact;
  if (pathname.startsWith("/api/dossier/")) return allowedRoles["/api/dossier"];
  if (/^\/api\/intake\/[^/]+$/.test(pathname)) {
    return { GET: ["rm", "analyst", "credit-manager"] };
  }
  if (/^\/api\/applications\/[^/]+\/notes$/.test(pathname)) {
    return { POST: ["analyst"] };
  }
  if (/^\/api\/applications\/[^/]+\/accept$/.test(pathname)) {
    return { POST: ["rm"] };
  }
  return undefined;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/api/") || pathname === "/api/reset" || pathname === "/api/session") {
    return NextResponse.next();
  }

  const policy = routePolicy(pathname);
  if (!policy) return NextResponse.next();

  const permitted = policy[request.method];
  if (!permitted) {
    return NextResponse.json({ error: "This operation is not available for this HTTP method." }, { status: 405 });
  }

  const role = request.cookies.get("kestrel-demo-role")?.value as Persona | undefined;
  if (!role || !["rm", "analyst", "credit-manager", "owner"].includes(role)) {
    return NextResponse.json({ error: "Sign in to access this workspace." }, { status: 401 });
  }
  if (!permitted.includes(role)) {
    return NextResponse.json(
      { error: `Access denied for the ${role} demo persona.` },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
