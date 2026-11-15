import type {
  AuditEntry,
  ExtractionResult,
  FinOpsEntry,
  LoanApplication,
  PdfTextBox,
  SpreadingData,
  SystemConfig,
  UploadedDocument,
} from "./types";
import { createDemoCustomerProfile } from "./demo-customer-profile";

const created = (daysAgo: number): string =>
  new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

interface DemoStore {
  applications: LoanApplication[];
  finOpsLedger: FinOpsEntry[];
  auditLedger: AuditEntry[];
  systemConfig: SystemConfig;
  uploadedDocuments: UploadedDocument[];
  documentTextById: Map<string, string>;
  documentTextBoxesById: Map<string, PdfTextBox[]>;
  summariesByApplication: Map<string, string>;
  spreadingResultsByApplication: Map<string, ExtractionResult>;
  piiTokenVault: Map<string, string>;
}

declare global {
  var kestrelFinanceDemoStore: DemoStore | undefined;
}

const seedApplications: LoanApplication[] = [
  {
    id: "KF-2026-001",
    applicantName: "Asterion Components Pvt Ltd",
    loanAmount: 12500000,
    status: "intake",
    createdAt: created(4),
  },
  {
    id: "KF-2026-002",
    applicantName: "Bluehaven Textiles",
    loanAmount: 8200000,
    status: "pending_docs",
    createdAt: created(14),
  },
  {
    id: "KF-2026-003",
    applicantName: "Cedar Peak Foods",
    loanAmount: 15750000,
    status: "pending_docs",
    createdAt: created(24),
  },
  {
    id: "KF-2026-004",
    applicantName: "Dovetail Mobility",
    loanAmount: 6400000,
    status: "pending_docs",
    createdAt: created(20),
  },
  {
    id: "KF-2026-005",
    applicantName: "Evergreen Packaging",
    loanAmount: 9300000,
    status: "decided",
    createdAt: created(28),
    decidedAt: created(6),
    decision: "Approve",
    signedBy: "Priya Menon",
    disbursedAt: created(6),
    disbursedBy: "Priya Menon",
    analystNotes: "Stable credits observed across the synthetic 12-month sample period.",
  },
  {
    id: "KF-2026-006",
    applicantName: "Fablewood Retail",
    loanAmount: 5100000,
    status: "decided",
    createdAt: created(40),
    decidedAt: created(13),
    withdrawn: true,
  },
  {
    id: "KF-2026-007",
    applicantName: "Northstar Precision Works",
    loanAmount: 6800000,
    status: "intake",
    createdAt: created(2),
  },
  {
    id: "KF-2026-008",
    applicantName: "Mango Grove Foods",
    loanAmount: 4200000,
    status: "intake",
    createdAt: created(1),
  },
  {
    id: "KF-2026-009",
    applicantName: "Aarav Medical Supplies",
    loanAmount: 9600000,
    status: "intake",
    createdAt: created(0),
  },
  {
    id: "KF-2026-010",
    applicantName: "Summit Agro Exports",
    loanAmount: 7400000,
    status: "intake",
    createdAt: created(3),
  },
  {
    id: "KF-2026-011",
    applicantName: "Indigo Fleet Services",
    loanAmount: 11800000,
    status: "intake",
    createdAt: created(5),
  },
];

export const initialApplications: LoanApplication[] = seedApplications.map((application) => ({
  ...application,
  customerProfile: createDemoCustomerProfile(application.id, application.applicantName),
}));

export const mockSpreadingData: SpreadingData = {
  period: "FY 2025-26",
  bankCreditsINR: 12450000,
  bankDebitsINR: 11900000,
  bankNetMovementINR: 550000,
  gstTurnoverINR: 11780000,
  gstVariancePercent: 5.69,
  monthsCovered: 12,
};

function defaultSystemConfig(): SystemConfig {
  return {
    activeModel: "kestrel-demo-primary",
    fallbackModel: "kestrel-demo-fast",
    gstVarianceThreshold: 10,
    tone: "professional",
    temperature: 0,
    unitCostPer1kTokensINR: 3.5,
    secondaryCostPer1kTokensINR: 1.8,
    agentPrompts: {
      intake: "Check document types and the exact 12-month reporting period. Do not infer missing documents.",
      communication: "Draft a professional, factual request for missing documents. Do not make a credit recommendation.",
      extraction: "Extract financial fields with document page citations. Never make a credit recommendation.",
      summary: "Write one factual paragraph about cash-flow dynamics only. Never recommend approval or decline.",
    },
  };
}

const store: DemoStore = globalThis.kestrelFinanceDemoStore ?? {
  applications: initialApplications.map((application) => ({ ...application })),
  finOpsLedger: [],
  auditLedger: [],
  systemConfig: defaultSystemConfig(),
  uploadedDocuments: [],
  documentTextById: new Map(),
  documentTextBoxesById: new Map(),
  summariesByApplication: new Map(),
  spreadingResultsByApplication: new Map(),
  piiTokenVault: new Map(),
};
if (!store.spreadingResultsByApplication) {
  store.spreadingResultsByApplication = new Map();
}
globalThis.kestrelFinanceDemoStore = store;

export let applications = store.applications;
export let finOpsLedger = store.finOpsLedger;
export const auditLedger = store.auditLedger;
export let systemConfig = store.systemConfig;
export const uploadedDocuments = store.uploadedDocuments;
export const documentTextById = store.documentTextById;
export const documentTextBoxesById = store.documentTextBoxesById;
export const summariesByApplication = store.summariesByApplication;
export const spreadingResultsByApplication = store.spreadingResultsByApplication;
export const piiTokenVault = store.piiTokenVault;

export const requiredMonths: string[] = Array.from({ length: 12 }, (_, index) => {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() - 11 + index, 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
});

export function recordAudit(
  entry: Omit<AuditEntry, "id" | "timestamp"> & { timestamp?: string },
): AuditEntry {
  const record: AuditEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: entry.timestamp ?? new Date().toISOString(),
  };
  auditLedger.push(record);
  if (auditLedger.length > 2000) auditLedger.splice(0, auditLedger.length - 2000);
  return record;
}

export function recordCost(
  entry: Omit<FinOpsEntry, "id" | "timestamp"> & { timestamp?: string },
): FinOpsEntry {
  const record: FinOpsEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: entry.timestamp ?? new Date().toISOString(),
  };
  finOpsLedger.push(record);
  if (finOpsLedger.length > 5000) finOpsLedger.splice(0, finOpsLedger.length - 5000);
  return record;
}

export function resetStore(): void {
  applications.splice(0, applications.length, ...initialApplications.map((item) => ({ ...item })));
  uploadedDocuments.splice(0);
  documentTextById.clear();
  documentTextBoxesById.clear();
  summariesByApplication.clear();
  spreadingResultsByApplication.clear();
  piiTokenVault.clear();
  finOpsLedger.splice(0);
  auditLedger.splice(0);
  Object.assign(systemConfig, defaultSystemConfig());
}
