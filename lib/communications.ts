import type { ApplicationStatus, CommunicationReason, Persona } from "./types";

export const communicationReasonsByPersona: Record<Persona, CommunicationReason[]> = {
  rm: ["missing-documents", "intake-received", "additional-information"],
  analyst: ["review-update", "statement-clarification", "additional-information"],
  "credit-manager": ["decision-outcome", "next-steps", "review-update"],
  owner: ["governance-summary", "audit-summary", "cost-summary"],
};

const personas: Persona[] = ["rm", "analyst", "credit-manager", "owner"];

export function isPersona(value: unknown): value is Persona {
  return typeof value === "string" && personas.includes(value as Persona);
}

export function isCommunicationReason(value: unknown): value is CommunicationReason {
  return typeof value === "string" &&
    Object.values(communicationReasonsByPersona).some((reasons) => reasons.includes(value as CommunicationReason));
}

export function isReasonAvailableForPersona(
  persona: Persona,
  reason: CommunicationReason,
): boolean {
  return communicationReasonsByPersona[persona].includes(reason);
}

export function getDemoPersona(request: Request): Persona | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)kestrel-demo-role=([^;]+)/);
  const role = match?.[1];
  return isPersona(role) ? role : null;
}

export function canCommunicateForApplication(
  persona: Exclude<Persona, "owner">,
  status: ApplicationStatus,
): boolean {
  if (persona === "rm") return status === "intake" || status === "pending_docs";
  if (persona === "analyst") return status === "spreading";
  return status === "signoff" || status === "decided";
}
