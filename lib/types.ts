export type ApplicationStatus =
  | "intake"
  | "pending_docs"
  | "spreading"
  | "signoff"
  | "decided";

export type Persona = "rm" | "analyst" | "credit-manager" | "owner";

export type DocumentCategory = "bank" | "gstr1" | "gstr3b";

export type AuditCategory =
  | "intake-check"
  | "agent-call"
  | "communication-simulated"
  | "pii-tokenized"
  | "prompt-injection-blocked"
  | "model-fallback"
  | "critic-intervention"
  | "critic-verified"
  | "human-signoff"
  | "manual-override"
  | "config-change";

export type MicroAction = "intake" | "extraction" | "critic" | "summary" | "communications";

export type CommunicationReason =
  | "missing-documents"
  | "intake-received"
  | "additional-information"
  | "review-update"
  | "statement-clarification"
  | "decision-outcome"
  | "next-steps"
  | "governance-summary"
  | "audit-summary"
  | "cost-summary";

export interface LoanApplication {
  id: string;
  applicantName: string;
  loanAmount: number;
  customerProfile?: DemoCustomerProfile;
  demoBureauScore?: number;
  demoBureauCheckedAt?: string;
  status: ApplicationStatus;
  createdAt: string;
  decidedAt?: string;
  decision?: CreditDecision;
  signedBy?: string;
  disbursedAt?: string;
  disbursedBy?: string;
  analystNotes?: string;
  withdrawn?: boolean;
}

export interface DemoCustomerProfile {
  contactName: string;
  email: string;
  businessAddress: string;
  promoterName: string;
}

export interface UploadedDocument {
  id: string;
  applicationId: string;
  category: DocumentCategory;
  fileName: string;
  pageCount: number;
  coveredMonths: string[];
  ocrApplied: boolean;
  uploadedAt: string;
  textAvailable: boolean;
}

export interface PdfTextBox {
  text: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  source: "pdf-text" | "pdf-ocr";
  confidence?: number;
}

export interface PdfCitation {
  documentId: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  source: "pdf-text" | "pdf-ocr";
  confidence?: number;
}

export interface IntakeCompleteness {
  complete: boolean;
  requiredMonths: string[];
  coverage: Record<DocumentCategory, string[]>;
  missingMonths: Record<DocumentCategory, string[]>;
  documents: UploadedDocument[];
  missingCategories: DocumentCategory[];
}

export interface SpreadingData {
  period: string;
  bankCreditsINR: number;
  bankDebitsINR: number;
  bankNetMovementINR: number;
  gstTurnoverINR: number;
  gstVariancePercent: number;
  monthsCovered: number;
  citations?: Record<string, PdfCitation>;
}

export interface ExtractionResult extends SpreadingData {
  fallbackUsed: boolean;
  model: string;
  criticVerified: boolean;
  agentConfidencePercent: number;
  criticConfidencePercent: number;
  fallbackReason?: string;
}

export interface AgentCriticResult {
  verified: boolean;
  confidencePercent: number;
  checks: string[];
}

export interface FinOpsEntry {
  id: string;
  applicationId: string;
  actionName: string;
  microAction: MicroAction;
  tokens: number;
  costINR: number;
  timestamp: string;
}

export interface AuditEntry {
  id: string;
  category: AuditCategory;
  event: string;
  userRole: string;
  timestamp: string;
  applicationId?: string;
  details?: Record<string, string | number | boolean | string[]>;
}

export interface AgentPrompts {
  intake: string;
  communication: string;
  extraction: string;
  summary: string;
}

export interface SystemConfig {
  activeModel: string;
  fallbackModel: string;
  gstVarianceThreshold: number;
  tone: "professional" | "concise" | "warm";
  temperature: number;
  unitCostPer1kTokensINR: number;
  secondaryCostPer1kTokensINR: number;
  agentPrompts: AgentPrompts;
}

export type CreditDecision = "Approve" | "Decline";

export interface ExecutiveMetrics {
  medianCycleDays: number;
  cycleBaselineDays: number;
  withdrawalRatePercent: number;
  withdrawalBaselinePercent: number;
  manualMinutesSaved: number;
  totalApplications: number;
}

export interface SummaryResult {
  summary: string;
  applicationId: string;
  generatedAt: string;
  model: string;
  containsRecommendation: false;
  criticVerified: boolean;
  criticConfidencePercent: number;
}
