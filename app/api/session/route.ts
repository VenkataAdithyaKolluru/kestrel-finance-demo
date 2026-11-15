import { NextResponse } from "next/server";
import { isRecord } from "../../../lib/request";
import { recordAudit } from "../../../lib/store";
import type { Persona } from "../../../lib/types";

const personas: Persona[] = ["rm", "analyst", "credit-manager", "owner"];

export async function GET(request: Request): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)kestrel-demo-role=([^;]+)/);
  const value = match?.[1] ? decodeURIComponent(match[1]) : null;
  const role = value && personas.includes(value as Persona) ? value as Persona : null;
  return Response.json({ role });
}

export async function POST(request: Request): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.role !== "string" || !personas.includes(body.role as Persona)) {
    return Response.json({ error: "Choose a valid User workspace role or Owner." }, { status: 400 });
  }
  const response = NextResponse.json({ role: body.role });
  recordAudit({
    category: "manual-override",
    event: `Demo session switched to ${body.role}`,
    userRole: "Demo Session",
  });
  response.cookies.set("kestrel-demo-role", body.role, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}

export async function DELETE(): Promise<Response> {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("kestrel-demo-role", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
