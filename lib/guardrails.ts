import { piiTokenVault, recordAudit } from "./store";

const promptInjectionPatterns: Array<[RegExp, string]> = [
  [/\bignore\s+(?:all\s+)?previous\s+instructions\b/i, "instruction override"],
  [/\bdisregard\s+(?:all\s+)?(?:prior|previous)\s+instructions\b/i, "instruction override"],
  [/\breveal\s+(?:the\s+)?(?:system|developer)\s+prompt\b/i, "prompt disclosure"],
  [/\bapprove\s+(?:this|the)\s+(?:loan|application|credit)\b/i, "decision manipulation"],
  [/\bdecline\s+(?:this|the)\s+(?:loan|application|credit)\b/i, "decision manipulation"],
  [/\bact\s+as\s+(?:the\s+)?credit\s+manager\b/i, "role impersonation"],
  [/\bexfiltrate\b/i, "data exfiltration"],
];

export function scanPromptInjection(text: string): string | null {
  for (const [pattern, reason] of promptInjectionPatterns) {
    if (pattern.test(text)) return reason;
  }
  return null;
}

export interface TokenizedText {
  text: string;
  tokenCount: number;
}

function replacePii(text: string): TokenizedText {
  let tokenCount = 0;
  const tokenized = text.replace(
    /\b(?:[A-Z]{5}\d{4}[A-Z]|\d{4}\s?\d{4}\s?\d{4})\b/gi,
    (value) => {
      tokenCount += 1;
      const token = `[PII_${crypto.randomUUID().slice(0, 8)}]`;
      piiTokenVault.set(token, value);
      return token;
    },
  );
  return { text: tokenized, tokenCount };
}

export function redactPii(text: string): string {
  return replacePii(text).text;
}

export function tokenizePii(
  text: string,
  applicationId: string,
  userRole: string,
): TokenizedText {
  const tokenized = replacePii(text);
  const { tokenCount } = tokenized;
  if (tokenCount > 0) {
    recordAudit({
      category: "pii-tokenized",
      event: `Tokenized ${tokenCount} sensitive identifier(s) before agent processing`,
      userRole,
      applicationId,
      details: { tokenCount },
    });
  }
  return tokenized;
}

export function containsCreditRecommendation(text: string): boolean {
  return /\b(recommend|recommendation|should)\s+(?:to\s+)?(?:approve|decline|reject)\b|\b(?:approve|decline|reject)\s+(?:this|the)\s+(?:loan|application|credit)\b/i.test(
    text,
  );
}
