import { applications, requiredMonths, uploadedDocuments } from "./store";
import type { DocumentCategory, IntakeCompleteness } from "./types";

export const documentCategories: DocumentCategory[] = ["bank", "gstr1", "gstr3b"];

export function getIntakeCompleteness(applicationId: string): IntakeCompleteness {
  const documents = uploadedDocuments.filter((document) => document.applicationId === applicationId);
  const coverage: Record<DocumentCategory, string[]> = {
    bank: [],
    gstr1: [],
    gstr3b: [],
  };
  for (const document of documents) {
    coverage[document.category] = [...new Set([...coverage[document.category], ...document.coveredMonths])].sort();
  }
  const missingMonths: Record<DocumentCategory, string[]> = {
    bank: requiredMonths.filter((month) => !coverage.bank.includes(month)),
    gstr1: requiredMonths.filter((month) => !coverage.gstr1.includes(month)),
    gstr3b: requiredMonths.filter((month) => !coverage.gstr3b.includes(month)),
  };
  const missingCategories = documentCategories.filter(
    (category) => coverage[category].length === 0,
  );
  const complete = documentCategories.every(
    (category) =>
      coverage[category].length === 12 &&
      requiredMonths.every((month) => coverage[category].includes(month)),
  );
  return {
    complete,
    requiredMonths: [...requiredMonths],
    coverage,
    missingMonths,
    documents,
    missingCategories,
  };
}

export function monthsFromStatementText(text: string): string[] {
  const months = new Set<string>();
  const monthIndex = new Map([
    ["jan", 1], ["january", 1], ["feb", 2], ["february", 2],
    ["mar", 3], ["march", 3], ["apr", 4], ["april", 4],
    ["may", 5], ["jun", 6], ["june", 6], ["jul", 7], ["july", 7],
    ["aug", 8], ["august", 8], ["sep", 9], ["sept", 9], ["september", 9],
    ["oct", 10], ["october", 10], ["nov", 11], ["november", 11],
    ["dec", 12], ["december", 12],
  ]);
  const namedMonth = /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\.?\s+(20\d{2})\b/gi;
  for (const match of text.matchAll(namedMonth)) {
    const month = monthIndex.get(match[1].toLowerCase());
    if (month) months.add(`${match[2]}-${String(month).padStart(2, "0")}`);
  }

  const yearFirst = /\b(20\d{2})[-/.](0?[1-9]|1[0-2])\b/g;
  for (const match of text.matchAll(yearFirst)) {
    months.add(`${match[1]}-${String(Number(match[2])).padStart(2, "0")}`);
  }
  const monthFirst = /\b(0?[1-9]|1[0-2])[-/.](20\d{2})\b/g;
  for (const match of text.matchAll(monthFirst)) {
    months.add(`${match[2]}-${String(Number(match[1])).padStart(2, "0")}`);
  }
  return [...months].sort();
}

export function isValidCategory(value: unknown): value is DocumentCategory {
  return typeof value === "string" && documentCategories.includes(value as DocumentCategory);
}

export function applicationExists(id: string): boolean {
  return applications.some((application) => application.id === id);
}
