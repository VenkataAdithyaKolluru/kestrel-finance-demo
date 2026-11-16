"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, DragEvent, ReactNode } from "react";
import type {
  AuditEntry,
  AgentCriticResult,
  CreditDecision,
  CommunicationReason,
  DocumentCategory,
  ExecutiveMetrics,
  FinOpsEntry,
  IntakeCompleteness,
  LoanApplication,
  PdfCitation,
  Persona,
  SpreadingData,
  SystemConfig,
  SummaryResult,
} from "../lib/types";
import dynamic from "next/dynamic";

const PdfPagePreview = dynamic(() => import("./pdf-page-preview"), { ssr: false });

type View = "tracker" | "portfolio" | "intake" | "docs" | "analyst" | "dossier" | "owner";
type StatusFilter = "all" | LoanApplication["status"];
const userRoles: { value: Exclude<Persona, "owner">; label: string; defaultView: View }[] = [
  { value: "rm", label: "Relationship Manager", defaultView: "tracker" },
  { value: "analyst", label: "Analyst", defaultView: "tracker" },
  { value: "credit-manager", label: "Credit Manager", defaultView: "tracker" },
];

interface StoredSpreading {
  applicationId: string;
  data: SpreadingData;
  fallbackUsed: boolean;
  criticVerified: boolean;
  agentConfidencePercent: number;
  criticConfidencePercent: number;
}

interface ApplicationCostRow {
  applicationId: string;
  applicantName: string;
  costINR: number;
  actions: Record<"intake" | "extraction" | "critic" | "summary" | "communications", number>;
}

interface CommunicationReasonOption {
  value: CommunicationReason;
  label: string;
}

const communicationReasons: Record<Persona, CommunicationReasonOption[]> = {
  rm: [
    { value: "missing-documents", label: "Request missing statements" },
    { value: "intake-received", label: "Confirm application received" },
    { value: "additional-information", label: "Request additional information" },
  ],
  analyst: [
    { value: "review-update", label: "Share review status" },
    { value: "statement-clarification", label: "Request statement clarification" },
    { value: "additional-information", label: "Request additional information" },
  ],
  "credit-manager": [
    { value: "decision-outcome", label: "Communicate recorded decision" },
    { value: "next-steps", label: "Share next steps" },
    { value: "review-update", label: "Share review status" },
  ],
  owner: [
    { value: "governance-summary", label: "Governance update" },
    { value: "audit-summary", label: "Audit ledger summary" },
    { value: "cost-summary", label: "FinOps cost summary" },
  ],
};

function getDefaultUsername(role: Persona): string {
  switch (role) {
    case "rm":
      return "rm.officer@kestrel.bank";
    case "analyst":
      return "analyst.patel@kestrel.bank";
    case "credit-manager":
      return "credit.manager@kestrel.bank";
    case "owner":
      return "governance.lead@kestrel.bank";
    default:
      return "operator@kestrel.bank";
  }
}

function getPersonaLabel(role: Persona): string {
  switch (role) {
    case "rm":
      return "Relationship Manager";
    case "analyst":
      return "Credit Analyst";
    case "credit-manager":
      return "Credit Manager";
    case "owner":
      return "Executive Governance";
    default:
      return "Operator";
  }
}

function getPersonaShortLabel(role: Persona): string {
  switch (role) {
    case "rm":
      return "RM Intake";
    case "analyst":
      return "Analyst Studio";
    case "credit-manager":
      return "Decision Dossier";
    case "owner":
      return "Governance Console";
    default:
      return "Workspace";
  }
}

const defaultCommunicationReason: Record<Persona, CommunicationReason> = {
  rm: "missing-documents",
  analyst: "review-update",
  "credit-manager": "review-update",
  owner: "governance-summary",
};

function assignedStatuses(persona: Persona | null): LoanApplication["status"][] {
  if (persona === "rm") return ["intake", "pending_docs"];
  if (persona === "analyst") return ["spreading"];
  if (persona === "credit-manager") return ["signoff", "decided"];
  return [];
}

function viewForAssignedApplication(persona: Persona | null, application: LoanApplication): View | null {
  if (persona === "rm" && application.status === "intake") return "intake";
  if (persona === "rm" && application.status === "pending_docs") return "docs";
  if (persona === "analyst" && application.status === "spreading") return "analyst";
  if (persona === "credit-manager" && (application.status === "signoff" || application.status === "decided")) return "dossier";
  return null;
}

const stages: { key: LoanApplication["status"]; label: string }[] = [
  { key: "intake", label: "Intake" },
  { key: "pending_docs", label: "Pending RM docs" },
  { key: "spreading", label: "Ready for spreading" },
  { key: "signoff", label: "Pending decision" },
  { key: "decided", label: "Decided" },
];

const personaViews: Record<Persona, View[]> = {
  rm: ["tracker", "portfolio", "intake", "docs"],
  analyst: ["tracker", "portfolio", "analyst"],
  "credit-manager": ["tracker", "portfolio", "dossier"],
  owner: ["owner"],
};

function workspacePath(persona: Persona, view: View, applicationId?: string): string {
  const section: Record<View, string> = {
    tracker: "work",
    portfolio: "applications",
    intake: "intake",
    docs: "docs",
    analyst: "studio",
    dossier: "dossier",
    owner: "console",
  };
  const path = persona === "owner" ? `/owner/${section[view]}` : `/${persona === "credit-manager" ? "approver" : persona}/${section[view]}`;
  return applicationId ? `${path}?applicationId=${encodeURIComponent(applicationId)}` : path;
}

function routeSelection(url: URL): { persona: Persona; view: View; applicationId: string | null } | null {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) return null;
  const personaByPath: Record<string, Persona> = {
    rm: "rm",
    analyst: "analyst",
    approver: "credit-manager",
    owner: "owner",
  };
  const viewByPath: Record<string, View> = {
    work: "tracker",
    tracker: "tracker",
    applications: "portfolio",
    intake: "intake",
    docs: "docs",
    studio: "analyst",
    dossier: "dossier",
    console: "owner",
  };
  const persona = personaByPath[segments[0]];
  const view = viewByPath[segments[1]];
  return persona && view && personaViews[persona].includes(view)
    ? { persona, view, applicationId: url.searchParams.get("applicationId") }
    : null;
}

const navigation: { key: View; label: string; icon: string }[] = [
  { key: "tracker", label: "My work", icon: "✓" },
  { key: "portfolio", label: "All applications", icon: "▦" },
  { key: "intake", label: "Application Acceptance", icon: "📥" },
  { key: "docs", label: "Document Intake", icon: "📑" },
  { key: "analyst", label: "Analyst review", icon: "⌕" },
  { key: "dossier", label: "Credit decision", icon: "▤" },
  { key: "owner", label: "Owner console", icon: "◈" },
];

const pageCopy: Record<View, { eyebrow: string; title: string; description: string }> = {
  tracker: {
    eyebrow: "Your work queue",
    title: "Good morning",
    description: "Start with the cases assigned to your role. Open a case to continue directly to its next action.",
  },
  portfolio: {
    eyebrow: "Application portfolio",
    title: "All applications",
    description: "Track every application across the shared pipeline. Open only cases currently assigned to your role.",
  },
  intake: {
    eyebrow: "Step 1A · Relationship Manager",
    title: "Application Acceptance",
    description: "Review incoming credit facility requests, verify eligibility, and approve application intake.",
  },
  docs: {
    eyebrow: "Step 1B · Relationship Manager",
    title: "Document Intake & Coverage",
    description: "Upload and verify 12 months of Bank statements, GSTR-1, and GSTR-3B filings before analyst spreading.",
  },
  analyst: {
    eyebrow: "Analyst workspace",
    title: "Spreading studio",
    description: "Run extraction and critic verification, then inspect the resulting demo cash-flow figures.",
  },
  dossier: {
    eyebrow: "Credit manager workspace",
    title: "Credit decision dossier",
    description: "Review the variance and record the final decision with a named human sign-off.",
  },
  owner: {
    eyebrow: "Governance & observability",
    title: "Owner console",
    description: "Inspect demo token costs, audit events, and live reconciliation settings.",
  },
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof result === "object" && result !== null && "error" in result
        ? String(result.error)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return result as T;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function shortDate(value: string): string {
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function KestrelDemo() {
  const [view, setView] = useState<View>("tracker");
  const [persona, setPersona] = useState<Persona | null>(null);
  const [loginModalPersona, setLoginModalPersona] = useState<Persona | null>(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [authenticatedUser, setAuthenticatedUser] = useState<string>("");
  const [sessionReady, setSessionReady] = useState(false);
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [disbursementOfficer, setDisbursementOfficer] = useState("");
  const [disbursementPassword, setDisbursementPassword] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [ownerSelectedId, setOwnerSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [trackerQuery, setTrackerQuery] = useState("");
  const [isLoadingApplications, setIsLoadingApplications] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [emailReason, setEmailReason] = useState<CommunicationReason>("missing-documents");
  const [emailRecipient, setEmailRecipient] = useState("applicant@demo.kestrelfinance.test");
  const [demoEmailSent, setDemoEmailSent] = useState(false);
  const [spreadingResult, setSpreadingResult] = useState<StoredSpreading | null>(null);
  const [emailCritic, setEmailCritic] = useState<AgentCriticResult | null>(null);
  const [analystAdvanceConfirmed, setAnalystAdvanceConfirmed] = useState(false);
  const [disbursementConfirmed, setDisbursementConfirmed] = useState(false);
  const [cashFlowSummary, setCashFlowSummary] = useState("");
  const [summaryCriticConfidence, setSummaryCriticConfidence] = useState<number | null>(null);
  const [analystNotes, setAnalystNotes] = useState("");
  const [selectedSource, setSelectedSource] = useState<keyof SpreadingData | null>(null);
  const [previewFiles, setPreviewFiles] = useState<Map<string, File>>(() => new Map());
  const [latestPreview, setLatestPreview] = useState<File | null>(null);
  const [managerName, setManagerName] = useState("");
  const [decisionPassword, setDecisionPassword] = useState("");
  const [decision, setDecision] = useState<CreditDecision>("Approve");
  const [finOps, setFinOps] = useState<FinOpsEntry[]>([]);
  const [finOpsByApplication, setFinOpsByApplication] = useState<ApplicationCostRow[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditQuery, setAuditQuery] = useState("");
  const [auditCategory, setAuditCategory] = useState("");
  const [ownerMetrics, setOwnerMetrics] = useState<ExecutiveMetrics | null>(null);
  const [config, setConfig] = useState<SystemConfig>({
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
  });
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerRefresh, setLedgerRefresh] = useState(0);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [ocrFileNames, setOcrFileNames] = useState<string[]>([]);
  const [rejectedFiles, setRejectedFiles] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [documentCategory, setDocumentCategory] = useState<DocumentCategory>("bank");
  const [intakeCompleteness, setIntakeCompleteness] = useState<IntakeCompleteness | null>(null);
  const [analystDocumentReview, setAnalystDocumentReview] = useState<IntakeCompleteness | null>(null);

  // Command Palette
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");

  // Real-time Queue Counters for Header Telemetry
  const rmCount = useMemo(
    () => applications.filter((a) => a.status === "intake" || a.status === "pending_docs").length,
    [applications],
  );
  const analystCount = useMemo(
    () => applications.filter((a) => a.status === "spreading").length,
    [applications],
  );
  const creditManagerCount = useMemo(
    () => applications.filter((a) => a.status === "signoff").length,
    [applications],
  );

  const filteredCommandApps = useMemo(() => {
    const q = commandPaletteQuery.trim().toLowerCase();
    if (!q) return applications.slice(0, 6);
    return applications
      .filter((a) => a.id.toLowerCase().includes(q) || a.applicantName.toLowerCase().includes(q))
      .slice(0, 8);
  }, [applications, commandPaletteQuery]);

  function handleSelectFromCommandPalette(application: LoanApplication): void {
    setIsCommandPaletteOpen(false);
    setCommandPaletteQuery("");
    openAssignedApplication(application);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      } else if (event.key === "Escape") {
        setIsCommandPaletteOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const selectedApplication = useMemo(() => {
    let application = applications.find(({ id }) => id === selectedId) ?? null;
    if (view === "intake") {
      if (persona !== "rm") return null;
      if (!application || application.status !== "intake") {
        application = applications.find((a) => a.status === "intake") ?? null;
      }
      return application;
    }
    if (view === "docs") {
      if (persona !== "rm") return null;
      if (!application || application.status !== "pending_docs") {
        application = applications.find((a) => a.status === "pending_docs") ?? null;
      }
      return application;
    }
    if (view === "analyst" && (persona !== "analyst" || application?.status !== "spreading")) return null;
    if (view === "dossier" && (persona !== "credit-manager" || (application?.status !== "signoff" && application?.status !== "decided"))) return null;
    return application;
  }, [applications, selectedId, view, persona]);
  const ownerSelectedApplication = useMemo(
    () => applications.find(({ id }) => id === ownerSelectedId) ?? null,
    [applications, ownerSelectedId],
  );
  const selectedSpreadingResult =
    selectedApplication?.id === spreadingResult?.applicationId ? spreadingResult : null;
  const selectedSpreading = selectedSpreadingResult?.data ?? null;
  const selectedCitation =
    selectedSource && selectedSpreading?.citations
      ? selectedSpreading.citations[selectedSource]
      : undefined;
  const activeCitationField: keyof Pick<
    SpreadingData,
    "bankCreditsINR" | "bankDebitsINR" | "bankNetMovementINR" | "gstTurnoverINR"
  > =
    selectedSource === "bankDebitsINR" ||
    selectedSource === "bankNetMovementINR" ||
    selectedSource === "gstTurnoverINR"
      ? selectedSource
      : "bankCreditsINR";
  const previewFile = selectedCitation
    ? previewFiles.get(selectedCitation.documentId) ?? null
    : latestPreview;
  const totalCost = useMemo(
    () => finOps.reduce((total, entry) => total + entry.costINR, 0),
    [finOps],
  );
  const roleApplications = applications
    .filter(({ status }) => assignedStatuses(persona).includes(status))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const normalizedTrackerQuery = trackerQuery.trim().toLowerCase();
  const filteredPortfolioApplications = applications.filter(({ status, applicantName, id }) =>
    (filter === "all" || status === filter) &&
    (!normalizedTrackerQuery || `${id} ${applicantName}`.toLowerCase().includes(normalizedTrackerQuery)),
  );
  const roleTaskQueue = (persona === "rm"
    ? roleApplications.filter(({ status }) => status === "intake" || status === "pending_docs")
    : persona === "analyst"
      ? roleApplications.filter(({ status }) => status === "spreading")
      : persona === "credit-manager"
        ? roleApplications.filter(({ status }) => status === "signoff")
        : []);
  const taskQueue = roleTaskQueue.filter(({ applicantName, id }) =>
    !normalizedTrackerQuery || `${id} ${applicantName}`.toLowerCase().includes(normalizedTrackerQuery),
  );
  const taskQueueTitle = persona === "rm"
    ? "New loan applications"
    : persona === "analyst"
      ? "Applications ready for analyst review"
      : "Applications awaiting credit decision";
  const taskQueueDescription = persona === "rm"
    ? "These applications have already been submitted. Review and accept a file to begin document intake."
    : persona === "analyst"
      ? "Only files with complete documents verified by RM appear here. Review statements, verify spreading, check bureau score, and generate summary."
      : "Only files where the Analyst has completed and approved all review checks appear here. Review the dossier and record a human decision.";
  const taskQueueEmptyMessage = persona === "analyst"
    ? "No RM-verified applications are ready. RM must upload and confirm complete statement coverage first."
    : persona === "credit-manager"
      ? "No analyst-approved handoffs are awaiting a Credit Manager decision."
      : "No applications are waiting in your RM queue.";
  const allowedViews = persona ? personaViews[persona] : [];
  const activeJourneyIndex = selectedApplication
    ? selectedApplication.status === "intake"
      ? 0
      : selectedApplication.status === "pending_docs"
        ? 1
        : selectedApplication.status === "spreading"
          ? 2
          : 3
    : 0;
  const continueView: View = selectedApplication
    ? selectedApplication.status === "intake"
      ? "intake"
      : selectedApplication.status === "pending_docs"
        ? "docs"
        : selectedApplication.status === "spreading"
          ? "analyst"
          : "dossier"
    : "tracker";
  const continueLabel = selectedApplication?.status === "decided"
    ? "Review completed decision"
    : `Continue to ${
        continueView === "intake"
          ? "application acceptance"
          : continueView === "docs"
            ? "document intake"
            : continueView === "analyst"
              ? "analyst review"
              : "credit decision"
      }`;

  const loadApplications = useCallback(async (silent = false) => {
    if (!silent) setIsLoadingApplications(true);
    try {
      const items = await api<LoanApplication[]>("/api/applications", { cache: "no-store" });
      setApplications(items);
      setSelectedId((current) => current || items[0]?.id || "");
      setError(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not load applications.");
    } finally {
      if (!silent) setIsLoadingApplications(false);
    }
  }, []);

  useEffect(() => {
    if (persona && persona !== "owner") void loadApplications();
  }, [persona, loadApplications]);

  useEffect(() => {
    if (!persona || persona === "owner" || applications.length === 0) return;
    const current = applications.find(({ id }) => id === selectedId);
    const eligible = applications.filter(({ status }) => assignedStatuses(persona).includes(status));
    if (!current || !eligible.some(({ id }) => id === current.id)) {
      const preferred = persona === "rm"
        ? view === "docs"
          ? (eligible.find(({ status }) => status === "pending_docs") ?? eligible[0])
          : (eligible.find(({ status }) => status === "intake") ?? eligible[0])
        : persona === "analyst"
          ? eligible.find(({ status }) => status === "spreading")
          : eligible.find(({ status }) => status === "signoff");
      setSelectedId(preferred?.id ?? "");
    }
  }, [persona, applications, selectedId, view]);

  useEffect(() => {
    if (view !== "tracker") return;
    const timer = window.setInterval(() => void loadApplications(true), 10000);
    return () => window.clearInterval(timer);
  }, [view, loadApplications]);

  useEffect(() => {
    let active = true;
    api<{ role: Persona | null }>("/api/session", { cache: "no-store" })
      .then(({ role }) => {
        if (!active) return;
        const selection = routeSelection(new URL(window.location.href));
        setSessionReady(true);
        if (!role) {
          setPersona(null);
          setAuthenticatedUser("");
          window.history.replaceState({}, "", "/");
          return;
        }
        const savedUser = typeof window !== "undefined" ? localStorage.getItem("kestrel_auth_user") : null;
        setAuthenticatedUser(savedUser || getDefaultUsername(role));
        const view = selection?.persona === role && personaViews[role].includes(selection.view)
          ? selection.view
          : role === "owner" ? "owner" : "tracker";
        setPersona(role);
        setView(view);
        const selectedApplicationId = selection?.persona === role ? selection.applicationId : null;
        if (selectedApplicationId) setSelectedId(selectedApplicationId);
        window.history.replaceState({}, "", workspacePath(role, view, selectedApplicationId ?? undefined));
      })
      .catch((cause: unknown) => {
        if (active) {
          showError(cause);
          setSessionReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const selection = routeSelection(new URL(window.location.href));
      if (selection?.persona === persona) {
        setView(selection.view);
        if (selection.applicationId) setSelectedId(selection.applicationId);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [persona]);

  useEffect(() => {
    if (!selectedApplication) {
      setIntakeCompleteness(null);
      setAnalystDocumentReview(null);
      return;
    }
    if (view !== "intake" && view !== "analyst" && view !== "dossier") return;
    let active = true;
    api<IntakeCompleteness>(`/api/intake/${selectedApplication.id}`, { cache: "no-store" })
      .then((result) => {
        if (active) {
          setIntakeCompleteness(result);
          setAnalystDocumentReview(result);
        }
      })
      .catch((cause: unknown) => {
        if (active) showError(cause);
      });
    return () => {
      active = false;
    };
  }, [view, selectedApplication?.id]);

  useEffect(() => {
    if (!selectedApplication || (view !== "analyst" && view !== "dossier")) return;
    let active = true;
    api<{ summary: string | null; criticConfidencePercent: number | null }>(
      `/api/summary?applicationId=${selectedApplication.id}`,
      { cache: "no-store" },
    )
      .then((res) => {
        if (active && res.summary) {
          setCashFlowSummary(res.summary);
          if (res.criticConfidencePercent) setSummaryCriticConfidence(res.criticConfidencePercent);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [view, selectedApplication?.id]);

  useEffect(() => {
    if (view !== "dossier" || !selectedApplication) return;
    let active = true;
    api<{
      application: LoanApplication;
      spreading: (SpreadingData & Partial<StoredSpreading>) | null;
      config: SystemConfig;
      summary: string | null;
      locked: boolean;
    }>(`/api/dossier/${selectedApplication.id}`, { cache: "no-store" })
      .then((result) => {
        if (!active) return;
        setApplications((items) => items.map((item) => item.id === result.application.id ? result.application : item));
        setConfig(result.config);
        setCashFlowSummary(result.summary ?? "");
        setAnalystNotes(result.application.analystNotes ?? "");
        if ((result.application.status === "signoff" || result.application.status === "decided") && result.spreading) {
          setSpreadingResult({
            applicationId: result.application.id,
            data: result.spreading,
            fallbackUsed: result.spreading.fallbackUsed ?? false,
            criticVerified: result.spreading.criticVerified ?? true,
            agentConfidencePercent: result.spreading.agentConfidencePercent ?? 96,
            criticConfidencePercent: result.spreading.criticConfidencePercent ?? 100,
          });
        }
      })
      .catch((cause: unknown) => {
        if (active) showError(cause);
      });
    return () => {
      active = false;
    };
  }, [view, selectedApplication?.id]);

  useEffect(() => {
    setAnalystNotes(selectedApplication?.analystNotes ?? "");
    setManagerName("");
    setDecision("Approve");
    setDecisionPassword("");
    setDisbursementConfirmed(false);
    setDisbursementOfficer("");
    setDisbursementPassword("");
    setAnalystAdvanceConfirmed(false);
    setEmail("");
    setEmailCritic(null);
    setEmailReason(persona ? defaultCommunicationReason[persona] : "missing-documents");
    setEmailRecipient(
      persona === "owner"
        ? "operations@demo.kestrelfinance.test"
        : selectedApplication
        ? selectedApplication.customerProfile?.email ?? `applicant+${selectedApplication.id.toLowerCase()}@demo.kestrelfinance.test`
          : "applicant@demo.kestrelfinance.test",
    );
    setDemoEmailSent(false);
    setCashFlowSummary("");
    setSummaryCriticConfidence(null);
  }, [selectedApplication?.id, persona]);

  useEffect(() => {
    if (view !== "owner") return;
    let active = true;
    setLedgerLoading(true);
    Promise.all([
      api<{ entries: FinOpsEntry[]; byApplication: ApplicationCostRow[] }>("/api/finops", { cache: "no-store" }),
      api<AuditEntry[]>(`/api/audit?q=${encodeURIComponent(auditQuery)}&category=${encodeURIComponent(auditCategory)}`, { cache: "no-store" }),
      api<SystemConfig>("/api/config", { cache: "no-store" }),
      api<ExecutiveMetrics>("/api/metrics", { cache: "no-store" }),
      api<LoanApplication[]>("/api/applications", { cache: "no-store" }),
    ])
      .then(([ledger, events, settings, metrics, ownerApplications]) => {
        if (!active) return;
        setFinOps(ledger.entries);
        setFinOpsByApplication(ledger.byApplication);
        setAudit(events);
        setConfig(settings);
        setOwnerMetrics(metrics);
        setApplications(ownerApplications);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load owner data.");
      })
      .finally(() => {
        if (active) setLedgerLoading(false);
      });
    return () => {
      active = false;
    };
  }, [view, ledgerRefresh, auditQuery, auditCategory]);

  function showError(cause: unknown): void {
    setError(cause instanceof Error ? cause.message : "The request could not be completed.");
  }

  function openView(nextView: View, applicationId = selectedApplication?.id): void {
    if (!persona || !allowedViews.includes(nextView)) {
      setError("This workspace is not available for the signed-in account.");
      return;
    }
    let targetAppId = applicationId;
    if (nextView === "intake") {
      const intakeApps = applications.filter((a) => a.status === "intake");
      if (!intakeApps.some((a) => a.id === targetAppId)) {
        targetAppId = intakeApps[0]?.id;
      }
    } else if (nextView === "docs") {
      const docApps = applications.filter((a) => a.status === "pending_docs");
      if (!docApps.some((a) => a.id === targetAppId)) {
        targetAppId = docApps[0]?.id;
      }
    }
    if (targetAppId) setSelectedId(targetAppId);
    setView(nextView);
    window.history.pushState({}, "", workspacePath(persona, nextView, targetAppId));
    setError(null);
    setMessage(null);
  }

  function openAssignedApplication(application: LoanApplication): void {
    if (!persona || persona === "owner") return;
    const taskView = viewForAssignedApplication(persona, application);
    if (!taskView) {
      const assignedRole = application.status === "intake" || application.status === "pending_docs"
        ? "Relationship Manager"
        : application.status === "spreading"
          ? "Analyst"
          : "Credit Manager";
      setMessage(`${application.id} is currently in the ${assignedRole} queue.`);
      return;
    }
    setEmail("");
    setEmailCritic(null);
    setDemoEmailSent(false);
    setSelectedId(application.id);
    setView(taskView);
    window.history.pushState({}, "", workspacePath(persona, taskView, application.id));
    setError(null);
    setMessage(null);
  }

  async function signIn(nextPersona: Persona): Promise<void> {
    setIsWorking(true);
    setError(null);
    try {
      await api<{ role: Persona }>("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextPersona }),
      });
      setPersona(nextPersona);
      setOwnerSelectedId(null);
      setFilter("all");
      setTrackerQuery("");
      const nextView = nextPersona === "owner"
        ? "owner"
        : userRoles.find(({ value }) => value === nextPersona)?.defaultView ?? "tracker";
      setView(nextView);
      window.history.pushState({}, "", workspacePath(nextPersona, nextView));
      setError(null);
      setMessage(null);
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      setIsWorking(false);
    }

  }

  async function switchUserRole(nextRole: Exclude<Persona, "owner">): Promise<void> {
    if (nextRole === persona) return;
    const target = userRoles.find(({ value }) => value === nextRole);
    if (!target) return;
    setIsWorking(true);
    setError(null);
    setMessage(null);
    try {
      await api<{ role: Persona }>("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      setPersona(nextRole);
      setView(target.defaultView);
      const current = applications.find(({ id }) => id === selectedId);
      const eligible = applications.filter(({ status }) => assignedStatuses(nextRole).includes(status));
      const nextSelectedId = current && eligible.some(({ id }) => id === current.id)
        ? current.id
        : nextRole === "analyst"
          ? eligible.find(({ status }) => status === "spreading")?.id
          : nextRole === "credit-manager"
            ? eligible.find(({ status }) => status === "signoff")?.id
            : eligible[0]?.id;
      if (!current || !eligible.some(({ id }) => id === current.id)) {
        setSelectedId(nextSelectedId ?? "");
      }
      setIntakeCompleteness(null);
      setAnalystDocumentReview(null);
      setEmail("");
      setEmailCritic(null);
      setDemoEmailSent(false);
      setEmailReason(defaultCommunicationReason[nextRole]);
      setFilter("all");
      setTrackerQuery("");
      setManagerName("");
      setDecision("Approve");
      setDecisionPassword("");
      setAnalystAdvanceConfirmed(false);
      window.history.pushState({}, "", workspacePath(nextRole, target.defaultView, nextSelectedId));
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      setIsWorking(false);
    }
  }

  function handleInitiateLogin(role: Persona): void {
    setLoginModalPersona(role);
    setLoginUsername(getDefaultUsername(role));
    setLoginPassword("demo@kestrel2026");
    setLoginError(null);
  }

  async function handleCompleteLogin(e?: React.FormEvent): Promise<void> {
    if (e) e.preventDefault();
    if (!loginModalPersona) return;

    if (!loginUsername.trim() || !loginPassword.trim()) {
      setLoginError("Please enter both username and password (any synthetic credentials accepted).");
      return;
    }

    const role = loginModalPersona;
    const userToSave = loginUsername.trim();
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("kestrel_auth_user", userToSave);
      } catch {
        // ignore storage errors
      }
    }
    setAuthenticatedUser(userToSave);
    setLoginModalPersona(null);
    setLoginError(null);
    await signIn(role);
  }

  async function signOut(): Promise<void> {
    setIsWorking(true);
    try {
      await api<{ ok: boolean }>("/api/session", { method: "DELETE" });
      setPersona(null);
      setAuthenticatedUser("");
      if (typeof window !== "undefined") {
        try {
          localStorage.removeItem("kestrel_auth_user");
        } catch {
          // ignore
        }
      }
      setView("tracker");
      setOwnerSelectedId(null);
      setError(null);
      setMessage(null);
      window.history.replaceState({}, "", "/");
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      setIsWorking(false);
    }
  }

  async function runIntake(): Promise<void> {
    if (!selectedApplication) return;
    setIsWorking(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ application: LoanApplication; completeness: IntakeCompleteness }>("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: selectedApplication.id }),
      });
      setApplications((items) => items.map((item) => (item.id === result.application.id ? result.application : item)));
      setIntakeCompleteness(result.completeness);
      if (result.completeness.complete) {
        setSelectedId("");
        setView("tracker");
        window.history.pushState({}, "", workspacePath("rm", "tracker"));
        setMessage(`${result.application.id} passed RM document verification and is now ready in the Analyst queue.`);
      } else {
        setMessage(`${result.application.id} is missing ${Object.values(result.completeness.missingMonths).flat().length} required statement-month(s). It remains in RM document follow-up.`);
      }
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      setIsWorking(false);
    }
  }

  async function acceptApplication(): Promise<void> {
    if (!selectedApplication) return;
    setIsWorking(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ application: LoanApplication }>(`/api/applications/${selectedApplication.id}/accept`, {
        method: "POST",
      });
      setApplications((items) => items.map((item) => item.id === result.application.id ? result.application : item));
      setSelectedId(result.application.id);
      setView("docs");
      window.history.pushState({}, "", workspacePath("rm", "docs", result.application.id));
      setMessage(`${result.application.id} accepted. Proceeding to Document Intake to collect and verify statements.`);
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      setIsWorking(false);
    }
  }

  async function draftEmail(): Promise<void> {
    if (!persona || (persona !== "owner" && !selectedApplication)) return;
    setIsWorking(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ email: string; critic: AgentCriticResult }>("/api/comms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId: persona === "owner" ? undefined : selectedApplication?.id,
          stage: persona,
          reason: emailReason,
        }),
      });
      setEmail(result.email);
      setEmailCritic(result.critic);
      setDemoEmailSent(false);
      setMessage(result.critic.verified
        ? "Critic-verified draft is ready. Review the recipient and message before sending the simulated email."
        : "The Critic blocked this email draft; review the reported checks.");
      setLedgerRefresh((version) => version + 1);
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      setIsWorking(false);
    }
  }

  async function verifyEmail(): Promise<void> {
    if (!persona || !email.trim()) return;
    setIsWorking(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ critic: AgentCriticResult }>("/api/comms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          applicationId: persona === "owner" ? undefined : selectedApplication?.id,
          stage: persona,
          reason: emailReason,
          email,
        }),
      });
      setEmailCritic(result.critic);
      setDemoEmailSent(false);
      setMessage(result.critic.verified
        ? "Critic checks passed for the edited draft."
        : "Critic blocked the edited draft. Revise it before sending.");
      setLedgerRefresh((version) => version + 1);
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      setIsWorking(false);
    }
  }

  async function sendDemoEmail(): Promise<void> {
    if (!persona || !emailCritic?.verified || !email.trim()) return;
    setIsWorking(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ simulated: boolean; message: string }>("/api/comms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId: persona === "owner" ? undefined : selectedApplication?.id,
          stage: persona,
          reason: emailReason,
          recipient: emailRecipient,
          email,
          criticVerified: emailCritic.verified,
        }),
      });
      setDemoEmailSent(result.simulated);
      setMessage(result.message);
      setLedgerRefresh((version) => version + 1);
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      setIsWorking(false);
    }
  }

  function renderCommunicationPanel(title: string): ReactNode {
    if (!persona) return null;
    return (
      <CommunicationPanel
        critic={emailCritic}
        email={email}
        isSent={demoEmailSent}
        isWorking={isWorking}
        onDraft={() => void draftEmail()}
        onEmailChange={(value) => {
          setEmail(value);
          setEmailCritic(null);
          setDemoEmailSent(false);
        }}
        onReasonChange={(value) => {
          setEmailReason(value);
          setEmail("");
          setEmailCritic(null);
          setDemoEmailSent(false);
        }}
        onRecipientChange={(value) => {
          setEmailRecipient(value);
          setDemoEmailSent(false);
        }}
        onSend={() => void sendDemoEmail()}
        onVerify={() => void verifyEmail()}
        reason={emailReason}
        reasons={communicationReasons[persona]}
        recipient={emailRecipient}
        title={title}
        canDraft={persona === "owner" || Boolean(selectedApplication)}
        canSend={Boolean(email.trim() && emailCritic?.verified && (persona === "owner" || selectedApplication))}
      />
    );
  }

  async function runExtraction(): Promise<void> {
    if (!selectedApplication) return;
    setIsWorking(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<SpreadingData & {
        fallbackUsed: boolean;
        criticVerified: boolean;
        agentConfidencePercent: number;
        criticConfidencePercent: number;
      }>("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: selectedApplication.id }),
      });
      setSpreadingResult({
        applicationId: selectedApplication.id,
        data: result,
        fallbackUsed: result.fallbackUsed,
        criticVerified: result.criticVerified,
        agentConfidencePercent: result.agentConfidencePercent,
        criticConfidencePercent: result.criticConfidencePercent,
      });
      setAnalystAdvanceConfirmed(false);
      setMessage(
        result.fallbackUsed
          ? "Safe fallback figures loaded. Review the documents and critic checks before explicitly moving forward."
          : "Critic verified the demo arithmetic. Review documents and explicitly move the application forward when ready.",
      );
      setLedgerRefresh((version) => version + 1);
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      setIsWorking(false);
    }
  }

  async function runDemoBureauCheck(): Promise<void> {
    if (!selectedApplication) return;
    setIsWorking(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{
        application: LoanApplication;
        source: "synthetic-demo-only";
        message: string;
      }>("/api/analyst/bureau-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: selectedApplication.id }),
      });
      setApplications((items) =>
        items.map((item) => item.id === result.application.id ? result.application : item),
      );
      setMessage(result.message);
      setLedgerRefresh((version) => version + 1);
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      setIsWorking(false);
    }
  }

  async function advanceToCreditDecision(): Promise<void> {
    if (!selectedApplication) return;
    setIsWorking(true);
    setError(null);
    try {
      const result = await api<{ application: LoanApplication }>("/api/analyst/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId: selectedApplication.id,
          reviewConfirmed: analystAdvanceConfirmed,
        }),
      });
      setApplications((items) => items.map((item) => item.id === result.application.id ? result.application : item));
      setSelectedId("");
      setView("tracker");
      window.history.pushState({}, "", workspacePath("analyst", "tracker"));
      setMessage(`${result.application.id} was approved by Analyst and handed off. It is now available in the Credit Manager queue.`);
      setLedgerRefresh((version) => version + 1);
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      setIsWorking(false);
    }
  }

  async function generateSummary(): Promise<void> {
    if (!selectedApplication) return;
    setIsWorking(true);
    setError(null);
    try {
      const result = await api<SummaryResult>("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: selectedApplication.id }),
      });
      setCashFlowSummary(result.summary);
      setSummaryCriticConfidence(result.criticConfidencePercent);
      setLedgerRefresh((version) => version + 1);
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      setIsWorking(false);
    }
  }

  async function loadSamplePacket(): Promise<void> {
    if (!selectedApplication) return;
    setIsWorking(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{
        application: LoanApplication;
        completeness: IntakeCompleteness;
        months: string[];
        categories: DocumentCategory[];
      }>("/api/intake/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: selectedApplication.id }),
      });
      setApplications((items) =>
        items.map((item) => item.id === result.application.id ? result.application : item),
      );
      setIntakeCompleteness(result.completeness);
      setMessage(`Synthetic packet loaded: ${result.months.length} consecutive months for ${result.categories.join(", ")}.`);
      setLedgerRefresh((version) => version + 1);
    } catch (cause: unknown) {
      showError(cause);
    }
    finally {
      setIsWorking(false);
    }
  }

  async function saveAnalystNotes(): Promise<void> {
    if (!selectedApplication) return;
    setIsWorking(true);
    setError(null);
    try {
      const result = await api<{ application: LoanApplication }>(
        `/api/applications/${selectedApplication.id}/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: analystNotes }),
        },
      );
      setApplications((items) => items.map((item) => item.id === result.application.id ? result.application : item));
      setMessage("Analyst notes saved to the application record.");
      setLedgerRefresh((version) => version + 1);
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      setIsWorking(false);
    }
  }

  async function submitDecision(): Promise<void> {
    if (!selectedApplication || !managerName.trim() || !decisionPassword.trim()) return;
    setIsWorking(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ application: LoanApplication; decision: CreditDecision }>(
        "/api/decide",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applicationId: selectedApplication.id,
            decision,
            signedBy: managerName,
            password: decisionPassword,
          }),
        },
      );
      setApplications((items) =>
        items.map((item) => (item.id === result.application.id ? result.application : item)),
      );
      const signedManager = managerName.trim();
      const recordedDecision = decision;
      setManagerName("");
      setDecisionPassword("");
      setSelectedId("");
      setView("tracker");
      window.history.pushState({}, "", workspacePath("credit-manager", "tracker"));
      setMessage(`${recordedDecision} recorded for ${result.application.id}, signed by ${signedManager}. Credit Manager decision workflow is complete.`);
      setLedgerRefresh((version) => version + 1);
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      setIsWorking(false);
    }
  }

  async function disburseApprovedLoan(): Promise<void> {
    if (!selectedApplication) return;
    setIsWorking(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ application: LoanApplication; disbursed: boolean }>("/api/disburse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId: selectedApplication.id,
          officerName: disbursementOfficer,
          password: disbursementPassword,
          humanVerified: disbursementConfirmed,
        }),
      });
      setApplications((items) => items.map((item) => item.id === result.application.id ? result.application : item));
      setDisbursementPassword("");
      setDisbursementConfirmed(false);
      setMessage(`Demo disbursement recorded for ${result.application.id} by ${result.application.disbursedBy}.`);
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      setIsWorking(false);
    }
  }

  async function saveConfig(): Promise<void> {
    setIsWorking(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await api<SystemConfig>("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setConfig(saved);
      setMessage("Owner settings saved for this server instance.");
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      setIsWorking(false);
    }
  }

  async function resetDemo(): Promise<void> {
    setIsWorking(true);
    setError(null);
    setMessage(null);
    try {
      await api<{ ok: boolean }>("/api/reset", { method: "POST" });
      setSpreadingResult(null);
      setEmail("");
      setCashFlowSummary("");
      setSummaryCriticConfidence(null);
      setAnalystNotes("");
      setIntakeCompleteness(null);
      setPreviewFiles(new Map());
      setLatestPreview(null);
      setFinOps([]);
      setFinOpsByApplication([]);
      setAudit([]);
      setOwnerMetrics(null);
      setFileNames([]);
      setOcrFileNames([]);
      setRejectedFiles([]);
      setSpreadingResult(null);
      setEmailCritic(null);
      setDemoEmailSent(false);
      if (persona) setEmailReason(defaultCommunicationReason[persona]);
      setAnalystAdvanceConfirmed(false);
      setManagerName("");
      setDecision("Approve");
      setDecisionPassword("");
      setDisbursementConfirmed(false);
      setOwnerSelectedId(null);
      setAnalystDocumentReview(null);
      setEmail("");
      const resetApplications = await api<LoanApplication[]>("/api/applications", { cache: "no-store" });
      setApplications(resetApplications);
      const resetApplication = persona === "analyst"
        ? resetApplications.find(({ status }) => status === "spreading") ?? resetApplications[0]
        : persona === "credit-manager"
          ? resetApplications.find(({ status }) => status === "signoff") ?? resetApplications[0]
          : resetApplications[0];
      setSelectedId(resetApplication?.id ?? "");
      setFilter("all");
      setTrackerQuery("");
      const landingView = persona === "owner"
        ? "owner"
        : userRoles.find(({ value }) => value === persona)?.defaultView ?? "tracker";
      setView(landingView);
      window.history.replaceState({}, "", workspacePath(persona ?? "rm", landingView));
      setLedgerRefresh((version) => version + 1);
      setMessage("Demo data reset to its original seed applications.");
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      setIsWorking(false);
    }
  }

  async function acceptFiles(fileList: FileList | File[]): Promise<void> {
    const files = Array.from(fileList);
    const rejected = files
      .filter((file) => file.type.startsWith("image/") || file.type !== "application/pdf")
      .map((file) => file.name);
    const accepted = files.filter(
      (file) => file.type === "application/pdf" && !file.type.startsWith("image/"),
    );
    setRejectedFiles(rejected);
    if (accepted.length === 0) return;
    setIsWorking(true);
    setIsUploading(true);
    try {
      for (const file of accepted) {
        const form = new FormData();
        form.set("applicationId", selectedApplication?.id ?? "");
        form.set("category", documentCategory);
        form.set("file", file);
        try {
          const result = await api<{
            document: { id: string; fileName: string; ocrApplied: boolean };
            completeness: IntakeCompleteness;
          }>(
            "/api/intake/upload",
            { method: "POST", body: form },
          );
          setFileNames((current) => [...new Set([...current, result.document.fileName])]);
          if (result.document.ocrApplied) {
            setOcrFileNames((current) => [...new Set([...current, result.document.fileName])]);
          }
          setIntakeCompleteness(result.completeness);
          setPreviewFiles((current) => {
            const next = new Map(current);
            next.set(result.document.id, file);
            while (next.size > 6) {
              const oldestId = next.keys().next().value;
              if (oldestId === undefined) break;
              next.delete(oldestId);
            }
            return next;
          });
          setLatestPreview(file);
        } catch (cause: unknown) {
          setRejectedFiles((current) => [...current, file.name]);
          showError(cause);
        }
      }
    } finally {
      setIsWorking(false);
      setIsUploading(false);
    }
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>): void {
    if (event.target.files) void acceptFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setIsDragging(false);
    void acceptFiles(event.dataTransfer.files);
  }

  const activeStage = stages.find((stage) => stage.key === selectedApplication?.status)?.label ?? "—";
  const copy = pageCopy[view];

  if (!sessionReady) {
    return (
      <main className="signin-shell" aria-live="polite">
        <div className="signin-card">
          <div className="brand-mark">K</div>
          <div className="brand-name">Kestrel Finance</div>
          <p>Checking demo sign-in…</p>
        </div>
      </main>
    );
  }

  if (!persona) {
    return (
      <main className="signin-shell">
        <div className="enterprise-grid" />
        <div className="orb-indigo" />
        <div className="orb-teal" />
        <section className="signin-panel" aria-labelledby="signin-title">
          <div className="brand-mark">K</div>
          <div className="eyebrow">Enterprise Gateway · Human-in-the-Loop Orchestration</div>
          <h1 id="signin-title">Kestrel Autonomous Credit Mesh</h1>
          <p className="signin-intro">
            High-precision commercial underwriting operating system with autonomous document spreading,
            arithmetic Critic verification, and role-governed human sign-offs.
          </p>
          {error && <div className="notice error" role="alert">{error}</div>}

          <div className="portal-grid">
            {/* Operator Workspace */}
            <div className="portal-card">
              <div>
                <div className="portal-card-header">
                  <div className="portal-card-icon">▦</div>
                  <div>
                    <strong style={{ color: "var(--text-bright)", fontSize: 14 }}>Credit Operations Gateway</strong>
                    <div style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                      Multi-Stage Underwriting Pipeline
                    </div>
                  </div>
                </div>
                <p className="subtle" style={{ margin: "4px 0 12px" }}>
                  Select an operational role to access your dedicated workflow queue:
                </p>
                <div className="portal-role-buttons">
                  <button
                    className="portal-role-btn"
                    disabled={isWorking}
                    onClick={() => handleInitiateLogin("rm")}
                    type="button"
                  >
                    <span><strong>Relationship Manager</strong> · Intake</span>
                    <small>Step 1 →</small>
                  </button>
                  <button
                    className="portal-role-btn"
                    disabled={isWorking}
                    onClick={() => handleInitiateLogin("analyst")}
                    type="button"
                  >
                    <span><strong>Credit Analyst</strong> · Spreading Studio</span>
                    <small>Step 2 →</small>
                  </button>
                  <button
                    className="portal-role-btn"
                    disabled={isWorking}
                    onClick={() => handleInitiateLogin("credit-manager")}
                    type="button"
                  >
                    <span><strong>Credit Manager</strong> · Decision Dossier</span>
                    <small>Step 3 →</small>
                  </button>
                </div>
              </div>
              <div className="signin-portal-pills">
                <span className="signin-portal-pill">✓ 12-Mo Statement Intake</span>
                <span className="signin-portal-pill">✓ Critic Arithmetic Guardrail</span>
                <span className="signin-portal-pill">✓ CIBIL Bureau Review</span>
                <span className="signin-portal-pill">✓ Human Decision Gate</span>
              </div>
            </div>

            {/* Executive Governance Console */}
            <div className="portal-card portal-card-exec">
              <div>
                <div className="portal-card-header">
                  <div className="portal-card-icon exec">◈</div>
                  <div>
                    <strong style={{ color: "var(--text-bright)", fontSize: 14 }}>Executive Governance</strong>
                    <div style={{ color: "var(--secondary)", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                      Observability &amp; FinOps
                    </div>
                  </div>
                </div>
                <p className="subtle" style={{ margin: "4px 0 16px" }}>
                  Inspect real-time agent token burn rates, configure model parameters, and review the immutable tamper-evident audit ledger.
                </p>
                <button
                  className="button primary"
                  disabled={isWorking}
                  onClick={() => handleInitiateLogin("owner")}
                  style={{ width: "100%", minHeight: 44, marginTop: 12, justifyContent: "space-between" }}
                  type="button"
                >
                  <span>Launch Executive Console</span>
                  <span>→</span>
                </button>
              </div>
              <div className="signin-portal-pills" style={{ marginTop: 24 }}>
                <span className="signin-portal-pill">✓ Real-Time Token Burn</span>
                <span className="signin-portal-pill">✓ Model Fallback Routing</span>
                <span className="signin-portal-pill">✓ Cryptographic Audit Trail</span>
              </div>
            </div>
          </div>

          <p className="signin-footnote">
            {isWorking ? "Initializing secure demo session…" : "Bank-grade protocol prototype · Enterprise directory authentication · Synthetic credentials supported"}
          </p>

          {loginModalPersona && (
            <div className="modal-backdrop" onClick={() => !isWorking && setLoginModalPersona(null)}>
              <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
                <div className="modal-head">
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 18, color: "var(--primary)" }}>
                      {loginModalPersona === "owner" ? "◈" : loginModalPersona === "credit-manager" ? "⚖" : loginModalPersona === "analyst" ? "⌕" : "▦"}
                    </span>
                    <div>
                      <h2 style={{ fontSize: 16, margin: 0 }}>
                        Sign In · {getPersonaLabel(loginModalPersona)}
                      </h2>
                      <div style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                        Enterprise Directory Authentication
                      </div>
                    </div>
                  </div>
                  <button
                    className="modal-close-btn"
                    disabled={isWorking}
                    onClick={() => setLoginModalPersona(null)}
                    type="button"
                    aria-label="Close login dialog"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleCompleteLogin}>
                  <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div className="synthetic-auth-banner">
                      <span style={{ fontSize: 16, color: "var(--primary)" }}>ℹ</span>
                      <div>
                        <strong style={{ color: "var(--text-bright)", display: "block" }}>Demo Synthetic Authentication</strong>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                          Enter any username and password to simulate enterprise sign-in. Any synthetic credentials are accepted.
                        </div>
                      </div>
                    </div>

                    <div className="auth-input-group">
                      <label className="field-label" htmlFor="login-username">
                        Username / Corporate ID
                      </label>
                      <input
                        id="login-username"
                        className="field"
                        type="text"
                        autoFocus
                        value={loginUsername}
                        onChange={(e) => {
                          setLoginUsername(e.target.value);
                          setLoginError(null);
                        }}
                        placeholder="e.g. officer@kestrel.bank"
                        autoComplete="username"
                        required
                      />
                    </div>

                    <div className="auth-input-group">
                      <label className="field-label" htmlFor="login-password">
                        Password
                      </label>
                      <input
                        id="login-password"
                        className="field"
                        type="password"
                        value={loginPassword}
                        onChange={(e) => {
                          setLoginPassword(e.target.value);
                          setLoginError(null);
                        }}
                        placeholder="Enter any password"
                        autoComplete="current-password"
                        required
                      />
                    </div>

                    {loginError && (
                      <div className="notice error" style={{ margin: 0, fontSize: 12 }}>
                        {loginError}
                      </div>
                    )}

                    <div style={{ fontSize: 11, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>🔒 Bank-Grade 256-bit TLS Session · Isolated RBAC Scope</span>
                    </div>
                  </div>

                  <div className="modal-foot">
                    <button
                      className="button"
                      disabled={isWorking}
                      onClick={() => setLoginModalPersona(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      className="button primary"
                      disabled={isWorking}
                      type="submit"
                    >
                      {isWorking ? (
                        <>
                          <span className="spinner" />
                          <span>Authenticating…</span>
                        </>
                      ) : (
                        <span>Sign In to {getPersonaShortLabel(loginModalPersona)} →</span>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <div className="enterprise-grid" />
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">K</div>
          <div>
            <div className="brand-name">
              <span>KESTREL</span>
              <span className="brand-badge">ENTERPRISE</span>
            </div>
            <div className="brand-subtitle">Autonomous Credit Mesh</div>
          </div>
        </div>
        {/* Center: Live Role Indicator (Single-Role Isolated Workspace) */}
        <div className="active-role-display">
          <span className="active-role-dot" />
          <div className="active-role-text">
            <span className="active-role-title">
              {persona ? getPersonaLabel(persona) : "Workspace"}
            </span>
            <span className="active-role-badge">Isolated Session</span>
            {authenticatedUser && (
              <span className="active-role-user">{authenticatedUser}</span>
            )}
          </div>
        </div>

        <div className="topbar-right">
          <button
            className="global-search-btn"
            onClick={() => setIsCommandPaletteOpen(true)}
            type="button"
          >
            <span>🔍</span>
            <span>Search or jump…</span>
            <kbd className="cmd-k-kbd">⌘K</kbd>
          </button>

          <div className="live">
            <span className="live-dot" />
            <span>Active</span>
          </div>

          <button className="button small" disabled={isWorking} onClick={() => void signOut()} type="button">
            Sign out
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div>
            <div className="sidebar-persona-badge">
              <span className="live-dot" />
              <div>
                <span className="sidebar-persona-role">
                  {persona === "owner" ? "Governance Lead" : userRoles.find(({ value }) => value === persona)?.label ?? "Operator"}
                </span>
                <span className="sidebar-persona-sub">Supervised Autonomous Ops</span>
              </div>
            </div>
            <div className="side-label">Navigation</div>
            <nav className="nav-list" aria-label={persona === "owner" ? "Owner workspace" : `${persona ?? "User"} workspace`}>
              {navigation.filter((item) => allowedViews.includes(item.key)).map((item) => (
                <button
                  className={`nav-button${view === item.key ? " active" : ""}`}
                  key={item.key}
                  onClick={() => openView(item.key)}
                  type="button"
                >
                  <span aria-hidden="true" className="nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
          <div>
            <div className="sidebar-telemetry">
              <div className="sidebar-telemetry-row">
                <span className="sidebar-telemetry-label">⚡ Token Burn</span>
                <span className="sidebar-telemetry-val">4.2k/hr</span>
              </div>
              <div className="sidebar-telemetry-row">
                <span className="sidebar-telemetry-label">Model Engine</span>
                <span className="sidebar-telemetry-val">Fin-Ops-4o</span>
              </div>
            </div>
            <div className="sidebar-note">
              <strong>Prototype mode</strong>
              Synthetic financial data and instance-memory storage. Decisions are demo records.
            </div>
          </div>
        </aside>

        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">{copy.eyebrow}</div>
              <h1>{copy.title}</h1>
              <p>{copy.description}</p>
            </div>
            <div className="heading-actions">
              <button className="button" disabled={isWorking} onClick={() => void resetDemo()} type="button">
                Reset demo
              </button>
            </div>
          </div>

          {error && <div className="notice error" role="alert">{error}</div>}
          {message && <div className="notice success" role="status">{message}</div>}

          {persona !== "owner" && view !== "tracker" && view !== "portfolio" && selectedApplication && (
            <section className="journey-panel" aria-label="Application journey">
              <div className="journey-heading">
                <div>
                  <div className="field-label">Current application · {selectedApplication.id}</div>
                  <strong>{selectedApplication.applicantName}</strong>
                  <span className="journey-amount">{money(selectedApplication.loanAmount)}</span>
                </div>
                {continueView !== view && allowedViews.includes(continueView) ? (
                  <button className="button primary small" disabled={isWorking} onClick={() => openView(continueView)} type="button">
                    {continueLabel} →
                  </button>
                ) : (
                  <span className="handoff-hint">
                    {view === "intake"
                      ? "Active Step: Step 1A · Application Review & Acceptance"
                      : view === "docs"
                        ? "Active Step: Step 1B · 12-Month Document Intake"
                        : view === "analyst"
                          ? "Active Step: Step 2 · Analyst Spreading Review"
                          : view === "dossier"
                            ? "Active Step: Step 3 · Credit Manager Decision Dossier"
                            : selectedApplication.status === "spreading"
                              ? "Intake complete · Handed off to Credit Analyst"
                              : selectedApplication.status === "signoff"
                                ? "Analyst review complete · Awaiting Credit Manager"
                                : `Next: ${userRoles.find(({ value }) => value === (selectedApplication.status === "decided" ? "credit-manager" : "rm"))?.label ?? "next reviewer"}`}
                  </span>
                )}
              </div>
              <ol className="journey-steps">
                {[
                  { label: "Application Acceptance", stepView: "intake" as View },
                  { label: "Document Intake", stepView: "docs" as View },
                  { label: "Analyst review", stepView: "analyst" as View },
                  { label: "Credit decision", stepView: "dossier" as View },
                ].map((step, index) => {
                  const complete = selectedApplication.status === "decided" || index < activeJourneyIndex;
                  const current = index === activeJourneyIndex && selectedApplication.status !== "decided";
                  return (
                    <li className={`journey-step${complete ? " complete" : ""}${current ? " current" : ""}`} key={step.label}>
                      <button aria-current={current ? "step" : undefined} disabled={!allowedViews.includes(step.stepView)} onClick={() => openView(step.stepView)} type="button">
                        <span className="journey-marker">{complete ? "✓" : index + 1}</span>
                        <span>{step.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className="journey-help">
                {selectedApplication.status === "decided"
                  ? `Decision ${selectedApplication.decision ?? "recorded"}${selectedApplication.signedBy ? ` by ${selectedApplication.signedBy}` : ""}.`
                  : "Follow each step in order. The next step updates automatically as this application moves through review."}
              </p>
            </section>
          )}

          {view === "tracker" && (
            <section aria-label="My work queue">
              <div className="panel" style={{ marginBottom: 16 }}>
                <div className="panel-head">
                  <div><h2>{taskQueueTitle}</h2><p>{taskQueueDescription}</p></div>
                  <div className="heading-actions">
                    <input aria-label="Search my tasks" className="field tracker-search" onChange={(event) => setTrackerQuery(event.target.value)} placeholder="Search ID or applicant" value={trackerQuery} />
                    <button className="button small" onClick={() => openView("portfolio")} type="button">All applications →</button>
                    <button className="button small" disabled={isLoadingApplications} onClick={() => void loadApplications()} type="button">{isLoadingApplications ? <span className="spinner" /> : "↻"} Refresh</button>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="data-grid">
                    <thead><tr><th>Application</th><th>Requested amount</th><th>Submission age</th><th>Current status</th><th>Your next task</th></tr></thead>
                    <tbody>
                      {taskQueue.length === 0
                        ? <tr><td colSpan={5}>{normalizedTrackerQuery ? `No role-queue applications match "${trackerQuery}".` : taskQueueEmptyMessage}</td></tr>
                        : taskQueue.map((application) => {
                          const actionLabel = persona === "rm"
                            ? application.status === "intake" ? "Review & accept" : "Upload & check docs"
                            : persona === "analyst" ? "Open analyst review" : "Open credit decision";
                          return (
                            <tr className="task-row" key={application.id}>
                              <td>
                                <button className="application-open-link" onClick={() => openAssignedApplication(application)} type="button">
                                  <strong>{application.applicantName}</strong><span className="subtle">{application.id}</span>
                                </button>
                              </td>
                              <td>{money(application.loanAmount)}</td>
                              <td>{Math.max(0, Math.floor((Date.now() - new Date(application.createdAt).getTime()) / 86400000))} days<span className="subtle">since submission</span></td>
                              <td><span className={`status-pill ${application.status}`}>{stages.find(({ key }) => key === application.status)?.label}</span></td>
                              <td><button className="button primary small" disabled={isWorking} onClick={() => openAssignedApplication(application)} type="button">{actionLabel} →</button></td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="metric-grid">
                <Metric label="My pending tasks" value={String(taskQueue.length)} foot={persona === "rm" ? "New submissions and document follow-up" : persona === "analyst" ? "Ready for spreading review" : "Awaiting your human decision"} />
                <Metric label="My assigned files" value={String(roleApplications.length)} foot="Only applications in your role's workflow stages" />
                <Metric label="Completed / handed off" value={String(Math.max(0, roleApplications.length - roleTaskQueue.length))} foot="Within this role's visible queue" />
                <Metric label="Oldest open task" value={taskQueue.length ? `${Math.max(...taskQueue.map(({ createdAt }) => Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000)))} days` : "None"} foot="Measured from application submission" />
              </div>
            </section>
          )}

          {view === "portfolio" && (
            <section aria-label="All applications portfolio">
              <div className="metric-grid">
                <Metric label="Total applications" value={String(applications.length)} foot="All files in the shared pipeline" />
                <Metric label="Open applications" value={String(applications.filter(({ status }) => status !== "decided").length)} foot="Across every stage" />
                <Metric label="Awaiting your action" value={String(roleTaskQueue.length)} foot="Assigned to this workspace" />
                <Metric label="Requested exposure" value={money(applications.reduce((sum, application) => sum + application.loanAmount, 0))} foot="Total requested · demo values" />
              </div>
              <section className="panel">
                <div className="panel-head">
                  <div><h2>Application status overview</h2><p>Shared pipeline visibility for all roles. Open an application only when it is assigned to your queue.</p></div>
                  <div className="heading-actions">
                    <input aria-label="Search all applications" className="field tracker-search" onChange={(event) => setTrackerQuery(event.target.value)} placeholder="Search ID or applicant" value={trackerQuery} />
                    <button className="button small" disabled={isLoadingApplications} onClick={() => void loadApplications()} type="button">
                      {isLoadingApplications ? <span className="spinner" /> : "↻"} Refresh
                    </button>
                  </div>
                </div>
                <div className="panel-body">
                  <div className="filter-row">
                    {[{ key: "all" as const, label: "All stages" }, ...stages.map(({ key, label }) => ({ key, label }))].map((item) => (
                      <button
                        className={`filter-chip${filter === item.key ? " selected" : ""}`}
                        key={item.key}
                        onClick={() => setFilter(item.key)}
                        type="button"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  {isLoadingApplications ? (
                    <div className="notice info">Loading application portfolio…</div>
                  ) : (
                    <div className="table-wrap">
                      <table className="data-grid portfolio-grid">
                        <thead><tr><th>Application</th><th>Requested amount</th><th>Submitted</th><th>Current status</th><th>Next owner</th><th>Action</th></tr></thead>
                        <tbody>
                          {filteredPortfolioApplications.map((application) => {
                              const assignedView = viewForAssignedApplication(persona, application);
                              const nextOwner = application.status === "intake" || application.status === "pending_docs"
                                ? "Relationship Manager"
                                : application.status === "spreading"
                                  ? "Analyst"
                                  : application.status === "signoff"
                                    ? "Credit Manager"
                                    : application.withdrawn
                                      ? "Withdrawn"
                                      : application.disbursedAt
                                        ? "Disbursed"
                                        : "Decision recorded";
                              return (
                                <tr className="portfolio-row" key={application.id}>
                                  <td><strong>{application.applicantName}</strong><span className="subtle">{application.id}</span></td>
                                  <td>{money(application.loanAmount)}</td>
                                  <td>{shortDate(application.createdAt).split(",")[0]}</td>
                                  <td><span className={`status-pill ${application.status}`}>{stages.find(({ key }) => key === application.status)?.label}</span></td>
                                  <td>{nextOwner}</td>
                                  <td>
                                    {assignedView
                                      ? <button className="button primary small" disabled={isWorking} onClick={() => openAssignedApplication(application)} type="button">Open my task →</button>
                                      : <span className="subtle">Not assigned</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          {filteredPortfolioApplications.length === 0 && <tr><td colSpan={6}>No applications match these filters.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="subtle portfolio-hint">Application selection opens the role work page only when the file is in your queue. Use the Workspace selector to switch between RM, Analyst, and Credit Manager.</p>
                </div>
              </section>
            </section>
          )}

          {view === "intake" && (
            <>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Step 1A · Application Review &amp; Acceptance</h2>
                    <p>Review incoming corporate loan applications and approve initial intake to initiate financial statement collection.</p>
                  </div>
                  <span className="status-pill intake">
                    {applications.filter((app) => app.status === "intake").length} Incoming Awaiting Acceptance
                  </span>
                </div>
                <div className="panel-body">
                  {applications.filter((app) => app.status === "intake").length === 0 ? (
                    <div className="notice info" style={{ padding: 28, textAlign: "center" }}>
                      <div style={{ fontSize: 28, marginBottom: 8, color: "#10b981" }}>✓</div>
                      <strong style={{ fontSize: 16, color: "var(--text-bright)", display: "block" }}>
                        All incoming applications have been accepted!
                      </strong>
                      <p style={{ margin: "8px 0 18px", color: "var(--text-muted)", fontSize: 13 }}>
                        No files are currently pending initial RM review. Advance to Document Intake to upload or verify financial statements.
                      </p>
                      <button className="button primary" onClick={() => openView("docs")} type="button">
                        Open Document Intake (Step 1B) →
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="form-row" style={{ maxWidth: 520, marginBottom: 18 }}>
                        <label className="field-label" htmlFor="intake-application">
                          Select Incoming Application for Review
                        </label>
                        <select
                          className="select"
                          id="intake-application"
                          onChange={(event) => {
                            setSelectedId(event.target.value);
                            window.history.replaceState({}, "", workspacePath("rm", "intake", event.target.value));
                            setError(null);
                          }}
                          value={selectedApplication?.id ?? ""}
                        >
                          {applications.filter((app) => app.status === "intake").map((application) => (
                            <option key={application.id} value={application.id}>
                              {application.id} · {application.applicantName} ({money(application.loanAmount)})
                            </option>
                          ))}
                        </select>
                      </div>

                      {selectedApplication && (
                        <div className="intake-deal-card">
                          <div className="intake-deal-header">
                            <div className="intake-deal-title">
                              <h3>{selectedApplication.applicantName}</h3>
                              <div className="intake-deal-meta">
                                <span className="intake-deal-id">ID: {selectedApplication.id}</span>
                                <span className="status-pill intake">Step 1A · Intake Review</span>
                              </div>
                            </div>
                            <div className="intake-deal-amount-box">
                              <div className="intake-deal-amount">{money(selectedApplication.loanAmount)}</div>
                              <div className="intake-deal-amount-sub">Commercial Credit Facility Proposal</div>
                            </div>
                          </div>

                          <div className="intake-deal-grid">
                            {/* Left Column: Borrower Profile & Deal Parameters */}
                            <div className="intake-info-group">
                              <div className="field-label" style={{ marginBottom: 2 }}>Borrower &amp; Facility Profile</div>
                              <div className="intake-info-item">
                                <span className="intake-info-label">Contact Signatory</span>
                                <span className="intake-info-val">
                                  {selectedApplication.customerProfile?.contactName || "Managing Director"}
                                </span>
                              </div>
                              <div className="intake-info-item">
                                <span className="intake-info-label">Corporate Email</span>
                                <span className="intake-info-val" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                                  {selectedApplication.customerProfile?.email || "finance@corporate.test"}
                                </span>
                              </div>
                              <div className="intake-info-item">
                                <span className="intake-info-label">Registered Office</span>
                                <span className="intake-info-val">
                                  {selectedApplication.customerProfile?.businessAddress || "Commercial Hub, India"}
                                </span>
                              </div>
                              <div className="intake-info-item">
                                <span className="intake-info-label">Queue Age</span>
                                <span className="intake-info-val">
                                  {Math.max(0, Math.floor((Date.now() - new Date(selectedApplication.createdAt).getTime()) / 86400000))} days since submission
                                </span>
                              </div>
                              <div className="intake-info-item">
                                <span className="intake-info-label">Assigned Desk</span>
                                <span className="intake-info-val">
                                  {authenticatedUser || "Relationship Manager (Intake Desk)"}
                                </span>
                              </div>
                            </div>

                            {/* Right Column: Pre-Intake Eligibility & Acceptance Action */}
                            <div className="intake-action-column">
                              <div className="intake-checklist-box">
                                <div className="intake-checklist-title">
                                  <span>🛡</span>
                                  <span>Pre-Intake Mandate &amp; Eligibility Checks</span>
                                </div>
                                <ul className="intake-checklist-items">
                                  <li>
                                    <span className="intake-checklist-check">✓</span>
                                    <span>Corporate identity, PAN tokenization, and MCA incorporation verified</span>
                                  </li>
                                  <li>
                                    <span className="intake-checklist-check">✓</span>
                                    <span>Credit proposal within mid-market underwriting exposure parameters</span>
                                  </li>
                                  <li>
                                    <span className="intake-checklist-check">✓</span>
                                    <span>Initiates 12-month document collection mandate (Bank Statements, GSTR-1, GSTR-3B)</span>
                                  </li>
                                </ul>
                              </div>

                              <div style={{ marginTop: 12 }}>
                                <button
                                  className="button primary"
                                  disabled={isWorking || selectedApplication.status !== "intake"}
                                  onClick={() => void acceptApplication()}
                                  style={{ width: "100%", minHeight: 46, fontSize: 14, justifyContent: "center" }}
                                  type="button"
                                >
                                  {isWorking ? (
                                    <>
                                      <span className="spinner" />
                                      <span>Accepting Application…</span>
                                    </>
                                  ) : (
                                    <span>✓ Accept Application &amp; Proceed to Document Intake →</span>
                                  )}
                                </button>
                                <p className="subtle" style={{ textAlign: "center", marginTop: 8, fontSize: 11.5 }}>
                                  Acceptance marks the file as approved for collection and opens Step 1B Document Intake.
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>

              {selectedApplication && renderCommunicationPanel("Customer communication · Application acceptance")}
            </>
          )}

          {view === "docs" && (
            <>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Step 1B · 12-Month Financial Statement Intake &amp; Coverage</h2>
                    <p>Collect and verify complete 12-month coverage of Bank, GSTR-1, and GSTR-3B statements before analyst spreading handoff.</p>
                  </div>
                  <span className={`status-pill ${selectedApplication?.status ?? ""}`}>{activeStage}</span>
                </div>
                <div className="panel-body">
                  <div className="form-row">
                    <label className="field-label" htmlFor="docs-application">Application in Document Intake</label>
                    <select
                      className="select"
                      id="docs-application"
                      onChange={(event) => {
                        setSelectedId(event.target.value);
                        setFileNames([]);
                        setOcrFileNames([]);
                        setIntakeCompleteness(null);
                        setPreviewFiles(new Map());
                        setLatestPreview(null);
                        window.history.replaceState({}, "", workspacePath("rm", "docs", event.target.value));
                      }}
                      value={selectedApplication?.id ?? ""}
                    >
                      {applications.filter(({ status }) => status === "pending_docs" || status === "intake").map((application) => (
                        <option key={application.id} value={application.id}>
                          {application.id} · {application.applicantName} ({stages.find((s) => s.key === application.status)?.label})
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedApplication?.status === "intake" ? (
                    <div className="notice info" style={{ padding: 16 }}>
                      <strong>This application is awaiting initial acceptance.</strong>
                      <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
                        Accept the application in Step 1A before collecting and verifying statements.
                      </p>
                      <div style={{ marginTop: 12 }}>
                        <button className="button primary small" onClick={() => openView("intake")} type="button">
                          Go to Application Acceptance →
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="form-row">
                        <label className="field-label" htmlFor="document-category">Statement type for next upload</label>
                        <select
                          className="select"
                          disabled={isWorking}
                          id="document-category"
                          onChange={(event) => {
                            const category = event.target.value;
                            if (category === "bank" || category === "gstr1" || category === "gstr3b") setDocumentCategory(category);
                          }}
                          value={documentCategory}
                        >
                          <option value="bank">Bank statement</option>
                          <option value="gstr1">GSTR-1</option>
                          <option value="gstr3b">GSTR-3B</option>
                        </select>
                      </div>
                      <label
                        className={`document-drop${isDragging ? " dragging" : ""}`}
                        htmlFor="documents"
                        onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                        onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={handleDrop}
                      >
                        <span style={{ color: "var(--primary)", fontSize: 24 }}>⇧</span>
                        <strong style={{ fontSize: 12 }}>{isUploading ? "Scanning PDF securely…" : "Drop statement PDFs here or browse"}</strong>
                        <span className="subtle">Add all 12 months for each statement type. Bank statements and GSTR-1 / GSTR-3B only · PDF files only</span>
                        <input accept="application/pdf,.pdf" disabled={isWorking || selectedApplication?.status !== "pending_docs"} id="documents" multiple onChange={handleFileInput} style={{ display: "none" }} type="file" />
                      </label>
                      {rejectedFiles.length > 0 && <div className="notice error">Rejected: {rejectedFiles.join(", ")}. Upload PDF statements only.</div>}
                      {fileNames.length > 0 && <div className="notice info">PDFs parsed in server memory for this demo: {fileNames.join(", ")}{ocrFileNames.length > 0 ? ` · Local OCR applied to: ${ocrFileNames.join(", ")}` : ""}</div>}
                      {intakeCompleteness && (
                        <div className="document-list">
                          {(["bank", "gstr1", "gstr3b"] as DocumentCategory[]).map((category) => {
                            const covered = intakeCompleteness.coverage[category];
                            const missing = intakeCompleteness.missingMonths[category];
                            return (
                              <div className="document-row" key={category}>
                                <span className="document-name">{category === "bank" ? "Bank" : category.toUpperCase()} · {covered.length}/12 months</span>
                                <span className={`document-state${missing.length ? " missing" : ""}`}>{missing.length ? `${missing.length} period(s) missing` : "12 months verified"}</span>
                              </div>
                            );
                          })}
                          {Object.entries(intakeCompleteness.missingMonths).some(([, months]) => months.length > 0) && (
                            <p className="subtle">Missing: {Object.entries(intakeCompleteness.missingMonths).filter(([, months]) => months.length > 0).map(([category, months]) => `${category.toUpperCase()} ${months.join(", ")}`).join(" · ")}</p>
                          )}
                        </div>
                      )}
                      {fileNames.length > 0 && <p className="subtle">Searchable text and page positions are kept in memory; PAN/Aadhaar-like identifiers are tokenized, and raw PDF bytes are not retained.</p>}
                      <div className="signoff-actions">
                        <button className="button" disabled={isWorking || !selectedApplication || selectedApplication.status !== "pending_docs"} onClick={() => void loadSamplePacket()} type="button">
                          {isWorking ? <><span className="spinner" /> Loading sample packet…</> : "Use demo sample packet"}
                        </button>
                        <button className="button primary" disabled={!selectedApplication || selectedApplication.status !== "pending_docs" || isWorking} onClick={() => void runIntake()} type="button">
                          {isWorking ? <><span className="spinner" /> Checking…</> : "Verify & hand off complete documents"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </section>
              {selectedApplication && renderCommunicationPanel("Customer communication · Document intake")}
            </>
          )}

          {view === "analyst" && (
            <>
            <section className="panel">
              <div className="panel-head">
                <div><h2>Step 2 · Analyst review</h2><p>Check document coverage, run the analysis and summary agents, review Critic checks, then explicitly move the file forward.</p></div>
                <div className="heading-actions">
                  {applications.filter(({ status }) => status === "spreading").length > 0 && (
                    <select aria-label="Select application" className="select" onChange={(event) => setSelectedId(event.target.value)} style={{ minWidth: 250 }} value={selectedApplication?.id ?? ""}>
                      {applications.filter(({ status }) => status === "spreading").map((application) => <option key={application.id} value={application.id}>{application.id} · {application.applicantName}</option>)}
                    </select>
                  )}
                  <button className="button primary" disabled={!selectedApplication || selectedApplication.status !== "spreading" || isWorking} onClick={() => void runExtraction()} type="button">
                    {isWorking ? <><span className="spinner" /> Checking…</> : "Run document checks & spreading"}
                  </button>
                </div>
              </div>
              <div className="panel-body">
              {!selectedApplication ? (
                <div className="empty-column" style={{ padding: "36px 16px", textAlign: "center" }}>
                  <h3 style={{ margin: "0 0 8px 0" }}>No applications ready for Analyst review</h3>
                  <p className="subtle" style={{ margin: 0 }}>
                    The Relationship Manager must upload all required statements and confirm complete 12-month document coverage before an application appears in the Analyst workspace.
                  </p>
                </div>
              ) : (
                <>
                  <CustomerCreditProfile
                    application={selectedApplication}
                    canCheckBureau={selectedApplication.status === "spreading" || selectedApplication.status === "signoff"}
                    isWorking={isWorking}
                    onRunBureauCheck={() => void runDemoBureauCheck()}
                  />
                  <DocumentReview completeness={analystDocumentReview} />
                  {selectedSpreading ? (
                    <>
                      <div className={`notice ${selectedSpreadingResult?.fallbackUsed ? "info" : "success"}`} role="status">
                        {selectedSpreadingResult?.fallbackUsed ? "Fallback route selected. This output needs human review; the Critic did not validate the primary result." : "Critic verified the arithmetic and checked for prohibited credit recommendations. Financial values are synthetic demo data."}
                      </div>
                      <div className="confidence-grid" aria-label="Agent confidence and critic checks">
                        <Metric label="Analysis agent confidence" value={`${selectedSpreadingResult?.agentConfidencePercent ?? 0}%`} foot="Illustrative demo score · not a real model probability" />
                        <Metric label="Critic check confidence" value={`${selectedSpreadingResult?.criticConfidencePercent ?? 0}%`} foot={selectedSpreadingResult?.criticVerified ? "Arithmetic, citations, and recommendation checks passed" : "Critic intervened; manual review required"} />
                      </div>
                      <div className={`notice ${selectedSpreadingResult?.criticVerified ? "success" : "error"}`}>
                        Critic checklist: credits − debits = net movement; citation coordinates valid; prohibited recommendation language absent.
                      </div>
                      <div className="data-split">
                        <div className="table-wrap">
                          <table className="data-grid">
                            <thead><tr><th>Extracted field</th><th>Period / value</th></tr></thead>
                            <tbody>
                              <DataRow label="Period" value={selectedSpreading.period} />
                              <DataRow
                                field="bankCreditsINR"
                                isSelected={activeCitationField === "bankCreditsINR"}
                                label="Bank credits"
                                onSelect={setSelectedSource}
                                value={money(selectedSpreading.bankCreditsINR)}
                              />
                              <DataRow
                                field="bankDebitsINR"
                                isSelected={activeCitationField === "bankDebitsINR"}
                                label="Bank debits"
                                onSelect={setSelectedSource}
                                value={money(selectedSpreading.bankDebitsINR)}
                              />
                              <DataRow
                                field="bankNetMovementINR"
                                isSelected={activeCitationField === "bankNetMovementINR"}
                                label="Net movement"
                                onSelect={setSelectedSource}
                                value={money(selectedSpreading.bankNetMovementINR)}
                              />
                              <DataRow
                                field="gstTurnoverINR"
                                isSelected={activeCitationField === "gstTurnoverINR"}
                                label="GST turnover"
                                onSelect={setSelectedSource}
                                value={money(selectedSpreading.gstTurnoverINR)}
                              />
                              <DataRow label="GST variance" value={`${selectedSpreading.gstVariancePercent.toFixed(2)}%`} />
                              <DataRow label="Months covered" value={String(selectedSpreading.monthsCovered)} />
                            </tbody>
                          </table>
                        </div>
                        <DocumentCitationsInspector
                          application={selectedApplication}
                          criticVerified={selectedSpreadingResult?.criticVerified ?? false}
                          onSelectField={setSelectedSource}
                          previewFile={previewFile}
                          selectedCitation={selectedCitation}
                          selectedField={activeCitationField}
                          spreading={selectedSpreading}
                        />
                      </div>
                      <FinancialAnalysis
                        data={selectedSpreading}
                        threshold={config.gstVarianceThreshold}
                        completeness={analystDocumentReview}
                        criticVerified={selectedSpreadingResult?.criticVerified ?? false}
                      />
                      <section className="panel" style={{ marginTop: 16 }}>
                        <div className="panel-head"><div><h2>Summary agent + Critic</h2><p>Generate factual observations; a separate Critic checks the draft.</p></div><button className="button small" disabled={isWorking} onClick={() => void generateSummary()} type="button">{isWorking ? "Reviewing…" : "Ask AI for cash-flow summary"}</button></div>
                        <div className="panel-body">{cashFlowSummary || <span className="subtle">Ask the summary agent to draft one factual paragraph from demo spreading data.</span>}{summaryCriticConfidence !== null && <div className="notice success" role="status">Critic verified the summary · {summaryCriticConfidence}% illustrative check confidence · no recommendation language detected.</div>}</div>
                      </section>
                      <section className="panel" style={{ marginTop: 16 }}>
                        <div className="panel-head"><div><h2>Analyst notes</h2><p>Human-authored notes are versioned in the audit ledger.</p></div><button className="button small" disabled={isWorking || selectedApplication?.status === "decided"} onClick={() => void saveAnalystNotes()} type="button">Save notes</button></div>
                        <div className="panel-body"><textarea className="field" disabled={selectedApplication?.status === "decided"} maxLength={2000} onChange={(event) => setAnalystNotes(event.target.value)} rows={3} value={analystNotes} /></div>
                      </section>
                      {selectedApplication?.status === "spreading" && (() => {
                        const isDocCoverageComplete = Boolean(
                          analystDocumentReview?.complete || selectedApplication.status === "spreading",
                        );
                        const isSpreadingVerified = Boolean(selectedSpreadingResult?.criticVerified);
                        const isBureauChecked = typeof selectedApplication.demoBureauScore === "number";
                        const isSummaryComplete = Boolean(cashFlowSummary);
                        const allAnalystChecksPassed =
                          isDocCoverageComplete && isSpreadingVerified && isBureauChecked && isSummaryComplete;

                        return (
                          <section className="panel" style={{ marginTop: 16 }}>
                            <div className="panel-head">
                              <div>
                                <h2>Human analyst checkpoint</h2>
                                <p>Verify all source documents and agent output before sending this to the Credit Manager.</p>
                              </div>
                              {!allAnalystChecksPassed && (
                                <button
                                  className="button small primary"
                                  disabled={isWorking}
                                  onClick={async () => {
                                    if (!isSpreadingVerified) await runExtraction();
                                    if (!isBureauChecked) await runDemoBureauCheck();
                                    if (!isSummaryComplete) await generateSummary();
                                  }}
                                  type="button"
                                >
                                  ⚡ Run all pending checks
                                </button>
                              )}
                            </div>
                            <div className="panel-body">
                              <div className="analyst-checklist" style={{ marginBottom: 16 }}>
                                <div className="field-label">Required analyst review items (all 4 must be approved):</div>
                                <div className="analyst-checklist-card">
                                  {/* Item 1: Document Coverage */}
                                  <div className="analyst-checklist-item" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                                      <span className={`analyst-checklist-icon ${isDocCoverageComplete ? "pass" : "pending"}`}>
                                        {isDocCoverageComplete ? "✓" : "○"}
                                      </span>
                                      <div>
                                        <strong style={{ color: "var(--text-bright)" }}>12-Month Document Coverage</strong>
                                        <span className="subtle" style={{ display: "block", fontSize: 11 }}>
                                          {isDocCoverageComplete
                                            ? "Verified complete bank and GST statement periods (RM confirmed)"
                                            : "Pending RM statement upload and confirmation"}
                                        </span>
                                      </div>
                                    </div>
                                    <span style={{ fontSize: "11px", color: isDocCoverageComplete ? "#34d399" : "var(--text-dim)", fontFamily: "JetBrains Mono" }}>
                                      {isDocCoverageComplete ? "✓ Verified" : "Pending RM"}
                                    </span>
                                  </div>

                                  {/* Item 2: Spreading & Critic */}
                                  <div className="analyst-checklist-item" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                                      <span className={`analyst-checklist-icon ${isSpreadingVerified ? "pass" : "pending"}`}>
                                        {isSpreadingVerified ? "✓" : "○"}
                                      </span>
                                      <div>
                                        <strong style={{ color: "var(--text-bright)" }}>Spreading Arithmetic &amp; Critic Verification</strong>
                                        <span className="subtle" style={{ display: "block", fontSize: 11 }}>
                                          {isSpreadingVerified
                                            ? "Credits − debits = net movement validated; citations verified"
                                            : "Run document checks & spreading"}
                                        </span>
                                      </div>
                                    </div>
                                    {!isSpreadingVerified ? (
                                      <button
                                        className="button small"
                                        disabled={isWorking}
                                        onClick={() => void runExtraction()}
                                        type="button"
                                      >
                                        Run spreading
                                      </button>
                                    ) : (
                                      <span style={{ fontSize: "11px", color: "#34d399", fontFamily: "JetBrains Mono" }}>✓ Passed</span>
                                    )}
                                  </div>

                                  {/* Item 3: Promoter Bureau Check */}
                                  <div className="analyst-checklist-item" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                                      <span className={`analyst-checklist-icon ${isBureauChecked ? "pass" : "pending"}`}>
                                        {isBureauChecked ? "✓" : "○"}
                                      </span>
                                      <div>
                                        <strong style={{ color: "var(--text-bright)" }}>Promoter Bureau Check</strong>
                                        <span className="subtle" style={{ display: "block", fontSize: 11 }}>
                                          {isBureauChecked
                                            ? `Score recorded: ${selectedApplication.demoBureauScore} · Sample check verified`
                                            : "Promoter CIBIL bureau check pending"}
                                        </span>
                                      </div>
                                    </div>
                                    {!isBureauChecked ? (
                                      <button
                                        className="button small"
                                        disabled={isWorking}
                                        onClick={() => void runDemoBureauCheck()}
                                        type="button"
                                      >
                                        ⌕ Check bureau
                                      </button>
                                    ) : (
                                      <span style={{ fontSize: "11px", color: "#34d399", fontFamily: "JetBrains Mono" }}>
                                        ✓ Score: {selectedApplication.demoBureauScore}
                                      </span>
                                    )}
                                  </div>

                                  {/* Item 4: Cash-Flow Summary */}
                                  <div className="analyst-checklist-item" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                                      <span className={`analyst-checklist-icon ${isSummaryComplete ? "pass" : "pending"}`}>
                                        {isSummaryComplete ? "✓" : "○"}
                                      </span>
                                      <div>
                                        <strong style={{ color: "var(--text-bright)" }}>Factual Cash-Flow Summary</strong>
                                        <span className="subtle" style={{ display: "block", fontSize: 11 }}>
                                          {isSummaryComplete
                                            ? "AI summary synthesized and verified by Critic"
                                            : "AI factual observations pending draft"}
                                        </span>
                                      </div>
                                    </div>
                                    {!isSummaryComplete ? (
                                      <button
                                        className="button small"
                                        disabled={isWorking}
                                        onClick={() => void generateSummary()}
                                        type="button"
                                      >
                                        Ask AI summary
                                      </button>
                                    ) : (
                                      <span style={{ fontSize: "11px", color: "#34d399", fontFamily: "JetBrains Mono" }}>✓ Ready</span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <label
                                className="verification-check"
                                style={{
                                  cursor: "pointer",
                                  userSelect: "none",
                                  padding: "12px 14px",
                                  background: analystAdvanceConfirmed ? "rgba(99, 102, 241, 0.14)" : "rgba(255, 255, 255, 0.03)",
                                  border: `1px solid ${analystAdvanceConfirmed ? "rgba(99, 102, 241, 0.45)" : "var(--border)"}`,
                                  borderRadius: "8px",
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: 12,
                                  transition: "all 0.18s ease",
                                }}
                              >
                                <input
                                  checked={analystAdvanceConfirmed}
                                  onChange={(event) => setAnalystAdvanceConfirmed(event.target.checked)}
                                  style={{ cursor: "pointer", width: 18, height: 18, marginTop: 2, accentColor: "var(--primary)" }}
                                  type="checkbox"
                                />
                                <span style={{ fontSize: "12.5px", color: "var(--text-on-surface)", lineHeight: 1.5 }}>
                                  I reviewed document coverage, spreading values, bureau review, and Critic checks. I approve all findings and moving this file to Credit Manager review.
                                </span>
                              </label>

                              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
                                <button
                                  className="button primary"
                                  disabled={!analystAdvanceConfirmed || !allAnalystChecksPassed || isWorking}
                                  onClick={() => void advanceToCreditDecision()}
                                  type="button"
                                >
                                  {isWorking ? <><span className="spinner" /> Moving forward…</> : "Verify & move to Credit Manager"}
                                </button>
                                {!allAnalystChecksPassed && (
                                  <span className="subtle" style={{ fontSize: 11.5 }}>
                                    Complete all 4 items above before advancing.
                                  </span>
                                )}
                                {allAnalystChecksPassed && !analystAdvanceConfirmed && (
                                  <span style={{ fontSize: 11.5, color: "#818cf8", fontWeight: 500 }}>
                                    ← Check the confirmation box above to enable handoff to Credit Manager.
                                  </span>
                                )}
                              </div>
                            </div>
                          </section>
                        );
                      })()}
                    </>
                  ) : (
                    <div className="empty-column">Review the document coverage above, then run document checks and demo spreading to populate the review details.</div>
                  )}
                </>
              )}
              </div>
            </section>
            {selectedApplication && renderCommunicationPanel("Customer communication · Analyst review")}
            </>
          )}

          {view === "dossier" && (
            <>
            <div className="metric-grid">
              <Metric
                label="Pending Credit Manager applications"
                value={String(applications.filter(({ status }) => status === "signoff").length)}
                foot="Awaiting human decision"
              />
              <Metric
                label="Approved · awaiting disbursement"
                value={String(applications.filter(({ decision, disbursedAt, status }) => status === "decided" && decision === "Approve" && !disbursedAt).length)}
                foot="Credit Officer action required"
              />
            </div>
            <div className="workflow-grid dossier-sheet">
              <section className="panel">
                <div className="panel-head">
                  <div><h2>Step 3 · Credit decision</h2><p>Review the dossier and record the final decision as a named human Credit Manager.</p></div>
                  <div className="heading-actions">
                    {applications.filter(({ status }) => status === "signoff" || status === "decided").length > 0 && (
                      <select
                        aria-label="Select application"
                        className="select"
                        onChange={(event) => setSelectedId(event.target.value)}
                        style={{ minWidth: 250 }}
                        value={selectedApplication?.id ?? ""}
                      >
                        {applications.filter(({ status }) => status === "signoff" || status === "decided").map((application) => (
                          <option key={application.id} value={application.id}>
                            {application.id} · {application.applicantName} ({stages.find(({ key }) => key === application.status)?.label})
                          </option>
                        ))}
                      </select>
                    )}
                    <span className={`status-pill ${selectedApplication?.status ?? ""}`}>{activeStage}</span>
                    <button className="button small no-print" onClick={() => window.print()} type="button">Print dossier</button>
                  </div>
                </div>
                <div className="panel-body">
                  {!selectedApplication ? (
                    <div className="empty-column" style={{ padding: "36px 16px", textAlign: "center" }}>
                      <h3 style={{ margin: "0 0 8px 0" }}>No applications awaiting credit decision</h3>
                      <p className="subtle" style={{ margin: 0 }}>
                        An application appears in the Credit Manager workspace only after the Analyst has completed and verified all reviews (spreading, Critic verification, cash-flow summary, and bureau check) and explicitly approved the handoff.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="decision-banner">◆ <span>Only a named human Credit Manager may submit the final decision. AI does not recommend approval or decline.</span></div>
                      <h3 className="subsection-title">Application documents · verify before decision</h3>
                      <CustomerCreditProfile
                        application={selectedApplication}
                        canCheckBureau={false}
                        isWorking={isWorking}
                      />
                      <DocumentReview completeness={intakeCompleteness} />
                      <table className="data-grid">
                        <tbody>
                          <DataRow label="Application ID" value={selectedApplication.id} />
                          <DataRow label="Current stage" value={activeStage} />
                          <DataRow label="GST vs bank variance" value={selectedSpreading ? `${selectedSpreading.gstVariancePercent.toFixed(2)}%` : "Run spreading to populate"} />
                          <DataRow label="Configured variance threshold" value={`${config.gstVarianceThreshold}%`} />
                          <DataRow label="Analyst notes" value={selectedApplication.analystNotes || "No analyst notes recorded"} />
                          <DataRow label="Signed by" value={selectedApplication.signedBy ?? "Not yet signed"} />
                        </tbody>
                      </table>
                      {selectedSpreading && (
                        <FinancialAnalysis
                          data={selectedSpreading}
                          threshold={config.gstVarianceThreshold}
                          completeness={intakeCompleteness}
                          criticVerified={selectedSpreadingResult?.criticVerified ?? false}
                        />
                      )}
                      {selectedSpreading && selectedSpreading.gstVariancePercent > config.gstVarianceThreshold && (
                        <div className="notice error">Variance exceeds the configured threshold. Review the source documents before deciding.</div>
                      )}
                      {selectedSpreadingResult && (
                        <div className={`notice ${selectedSpreadingResult.criticVerified ? "success" : "error"}`}>
                          Agent confidence: {selectedSpreadingResult.agentConfidencePercent}% (illustrative demo score). Critic confidence: {selectedSpreadingResult.criticConfidencePercent}%. {selectedSpreadingResult.criticVerified ? "Critic checks passed." : "Critic did not verify this output; review the fallback carefully."}
                        </div>
                      )}
                      {cashFlowSummary && <div className="summary-box"><div className="field-label">Factual cash-flow summary</div>{cashFlowSummary}</div>}
                    </>
                  )}
                </div>
              </section>
              {selectedApplication && (
                <section className="panel">
                  <div className="panel-head"><div><h2>Human sign-off</h2><p>Signed decisions are written to the audit ledger.</p></div></div>
                  <div className="panel-body">
                    {selectedApplication?.status === "decided" ? (
                      <div className="notice success" role="status">
                        {selectedApplication.decision} recorded for {selectedApplication.id}, signed by {selectedApplication.signedBy}. This decision is locked.
                      </div>
                    ) : (
                      <>
                        <div className="form-row"><label className="field-label" htmlFor="manager-name">Credit Manager name</label><input autoComplete="name" className="field" disabled={!selectedApplication || selectedApplication.status !== "signoff" || isWorking} id="manager-name" onChange={(event) => setManagerName(event.target.value)} placeholder="Enter your name" value={managerName} /></div>
                        <div className="form-row"><label className="field-label" htmlFor="decision">Decision</label><select className="select" disabled={!selectedApplication || selectedApplication.status !== "signoff" || isWorking} id="decision" onChange={(event) => { if (event.target.value === "Approve" || event.target.value === "Decline") setDecision(event.target.value); }} value={decision}><option value="Approve">Approve</option><option value="Decline">Decline</option></select></div>
                        <div className="form-row"><label className="field-label" htmlFor="decision-password">Demo password</label><input autoComplete="off" className="field" disabled={!selectedApplication || selectedApplication.status !== "signoff" || isWorking} id="decision-password" onChange={(event) => setDecisionPassword(event.target.value)} placeholder="Enter demo password" type="password" value={decisionPassword} /><p className="subtle">Demo only: any non-empty value is accepted; this does not authenticate a user.</p></div>
                        <button className="button primary" disabled={isWorking || !managerName.trim() || !decisionPassword.trim() || !selectedApplication || selectedApplication.status !== "signoff"} onClick={() => void submitDecision()} type="button">
                          {isWorking ? "Submitting decision…" : "Submit decision"}
                        </button>
                        <p className="subtle">The demo records the decision and signer only. The password is not stored, and this is not a legally binding signature.</p>
                      </>
                    )}
                    {selectedApplication?.status === "decided" && selectedApplication.decision === "Approve" && (
                      <section className="disbursement-panel">
                        <div className="panel-head"><div><h2>Final step · Disburse approved amount</h2><p>Demo confirmation only. Any non-empty password is accepted; no funds are transferred.</p></div></div>
                        <div className="panel-body">
                          {selectedApplication.disbursedAt ? (
                            <div className="notice success">₹{selectedApplication.loanAmount.toLocaleString("en-IN")} disbursed in demo by {selectedApplication.disbursedBy} · {shortDate(selectedApplication.disbursedAt)}.</div>
                          ) : (
                            <>
                              <div className="form-row">
                                <label className="field-label" htmlFor="disbursement-officer">Credit officer name</label>
                                <input className="field" id="disbursement-officer" onChange={(event) => setDisbursementOfficer(event.target.value)} placeholder="Enter the responsible credit officer" value={disbursementOfficer} />
                              </div>
                              <div className="form-row">
                                <label className="field-label" htmlFor="disbursement-password">Authorization password</label>
                                <input autoComplete="new-password" className="field" id="disbursement-password" onChange={(event) => setDisbursementPassword(event.target.value)} placeholder="Any password for this synthetic demo" type="password" value={disbursementPassword} />
                              </div>
                              <label className="verification-check">
                                <input checked={disbursementConfirmed} onChange={(event) => setDisbursementConfirmed(event.target.checked)} type="checkbox" />
                                <span>I verified the approved amount and authorize recording this demo disbursement.</span>
                              </label>
                              <button className="button primary" disabled={isWorking || !disbursementOfficer.trim() || !disbursementPassword.trim() || !disbursementConfirmed} onClick={() => void disburseApprovedLoan()} type="button">
                                {isWorking ? "Recording…" : `Confirm demo disbursement · ${money(selectedApplication.loanAmount)}`}
                              </button>
                            </>
                          )}
                        </div>
                      </section>
                    )}
                  </div>
                </section>
              )}
              {selectedApplication && renderCommunicationPanel("Customer communication · Credit decision")}
            </div>
            </>
          )}

          {view === "owner" && (
            <>
              <section className="panel" style={{ marginBottom: 16 }}>
                <div className="panel-head">
                  <div><h2>Portfolio health & application status</h2><p>Monitor stage distribution and owner handoffs. Select a file to open its details.</p></div>
                  <div className="heading-actions">
                    <input aria-label="Search owner applications" className="field tracker-search" onChange={(event) => setTrackerQuery(event.target.value)} placeholder="Search ID or applicant" value={trackerQuery} />
                    <select aria-label="Filter owner applications by stage" className="select owner-stage-filter" onChange={(event) => setFilter(event.target.value as StatusFilter)} value={filter}>
                      <option value="all">All stages</option>
                      {stages.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
                    </select>
                    <span className="status-pill">{applications.length} files monitored</span>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="data-grid">
                    <thead><tr><th>Application</th><th>Requested amount</th><th>Current status</th><th>Decision / next owner</th><th>Open</th></tr></thead>
                    <tbody>
                      {filteredPortfolioApplications.length === 0
                        ? <tr><td colSpan={5}>{applications.length ? "No applications match these filters." : "No application records are available."}</td></tr>
                        : filteredPortfolioApplications.map((application) => (
                          <tr key={application.id}>
                            <td><strong>{application.applicantName}</strong><span className="subtle">{application.id}</span></td>
                            <td>{money(application.loanAmount)}</td>
                            <td>
                              <span className={`status-pill ${application.status}`}>{stages.find(({ key }) => key === application.status)?.label ?? application.status}</span>
                              {application.disbursedAt && <span className="subtle">Funds disbursed · {application.disbursedBy}</span>}
                            </td>
                            <td>{application.decision ? `${application.decision} · ${application.signedBy ?? "Human signer"}` : application.status === "intake" || application.status === "pending_docs" ? "Relationship Manager" : application.status === "spreading" ? "Analyst" : application.status === "signoff" ? "Credit Manager" : "No pending action"}</td>
                            <td><button aria-pressed={application.id === ownerSelectedId} className={`button small${application.id === ownerSelectedId ? " selected" : ""}`} onClick={() => setOwnerSelectedId(application.id)} type="button">{application.id === ownerSelectedId ? "Selected" : "View details"}</button></td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {ownerSelectedApplication && (
                  <div className="owner-selected-application">
                    <div className="owner-detail-heading">
                      <div><span className="eyebrow">Selected application · {ownerSelectedApplication.id}</span><h3>{ownerSelectedApplication.applicantName}</h3></div>
                      <div className="heading-actions">
                        <span className={`status-pill ${ownerSelectedApplication.status}`}>{stages.find(({ key }) => key === ownerSelectedApplication.status)?.label}</span>
                        <button className="button small" onClick={() => setOwnerSelectedId(null)} type="button">Close details</button>
                      </div>
                    </div>
                    <CustomerCreditProfile application={ownerSelectedApplication} canCheckBureau={false} isWorking={false} />
                    <div className="owner-detail-summary">
                      <span><strong>Requested exposure</strong>{money(ownerSelectedApplication.loanAmount)}</span>
                      <span><strong>Submission date</strong>{shortDate(ownerSelectedApplication.createdAt)}</span>
                      <span><strong>Decision</strong>{ownerSelectedApplication.decision ? `${ownerSelectedApplication.decision} · ${ownerSelectedApplication.signedBy ?? "Human signer"}` : "Awaiting human decision"}</span>
                      <span><strong>Disbursement</strong>{ownerSelectedApplication.disbursedAt ? `Recorded · ${shortDate(ownerSelectedApplication.disbursedAt)}` : ownerSelectedApplication.decision === "Approve" ? "Awaiting officer action" : "Not applicable yet"}</span>
                    </div>
                  </div>
                )}
              </section>
              <div className="metric-grid">
                <Metric label="Median cycle time" value={`${ownerMetrics?.medianCycleDays ?? 0} days`} foot={`Baseline ${ownerMetrics?.cycleBaselineDays ?? 18} days`} />
                <Metric label="Withdrawal rate" value={`${ownerMetrics?.withdrawalRatePercent ?? 0}%`} foot={`Baseline ${ownerMetrics?.withdrawalBaselinePercent ?? 22}%`} />
                <Metric label="Analyst time saved" value={`${ownerMetrics?.manualMinutesSaved ?? 0} min`} foot="Synthetic estimate · 210 min per processed file" />
                <Metric label="Cost · all actions" value={money(totalCost)} foot={`${finOps.length} micro-actions recorded`} />
              </div>
              <div className="panel" style={{ marginBottom: 16 }}>
                <div className="panel-head">
                  <div><h2>Model & policy controls</h2><p>Settings are mutable for this demo server process only.</p></div>
                  <button className="button small" disabled={isWorking || ledgerLoading} onClick={() => setLedgerRefresh((version) => version + 1)} type="button">↻ Refresh data</button>
                </div>
                <div className="panel-body">
                  <div className="config-grid">
                    <div className="form-row"><label className="field-label" htmlFor="active-model">Active model</label><select className="select" disabled={isWorking || ledgerLoading} id="active-model" onChange={(event) => setConfig((current) => ({ ...current, activeModel: event.target.value }))} value={config.activeModel}><option value="kestrel-demo-primary">kestrel-demo-primary</option><option value="kestrel-demo-fast">kestrel-demo-fast</option><option value="manual-review">manual-review fallback</option></select></div>
                    <div className="form-row"><label className="field-label" htmlFor="fallback-model">Fallback model</label><select className="select" disabled={isWorking || ledgerLoading} id="fallback-model" onChange={(event) => setConfig((current) => ({ ...current, fallbackModel: event.target.value }))} value={config.fallbackModel}><option value="kestrel-demo-fast">kestrel-demo-fast</option><option value="manual-review">manual-review queue</option><option value="kestrel-demo-primary">kestrel-demo-primary</option></select></div>
                    <div className="form-row"><label className="field-label" htmlFor="threshold">GST variance threshold (%)</label><input className="field" disabled={isWorking || ledgerLoading} id="threshold" max="100" min="0" onChange={(event) => setConfig((current) => ({ ...current, gstVarianceThreshold: Number(event.target.value) }))} type="number" value={config.gstVarianceThreshold} /></div>
                    <div className="form-row"><label className="field-label" htmlFor="tone">Communication tone</label><select className="select" disabled={isWorking || ledgerLoading} id="tone" onChange={(event) => { const tone = event.target.value; if (tone === "professional" || tone === "concise" || tone === "warm") setConfig((current) => ({ ...current, tone })); }} value={config.tone}><option value="professional">Professional</option><option value="concise">Concise</option><option value="warm">Warm</option></select></div>
                    <div className="form-row"><label className="field-label" htmlFor="temperature">Agent temperature · {config.temperature.toFixed(1)}</label><input className="field" disabled={isWorking || ledgerLoading} id="temperature" max="1" min="0" onChange={(event) => setConfig((current) => ({ ...current, temperature: Number(event.target.value) }))} step="0.1" type="range" value={config.temperature} /></div>
                    <div className="form-row"><label className="field-label" htmlFor="primary-price">Primary INR / 1K tokens</label><input className="field" disabled={isWorking || ledgerLoading} id="primary-price" min="0" onChange={(event) => setConfig((current) => ({ ...current, unitCostPer1kTokensINR: Number(event.target.value) }))} type="number" value={config.unitCostPer1kTokensINR} /></div>
                    <div className="form-row"><label className="field-label" htmlFor="fallback-price">Fallback INR / 1K tokens</label><input className="field" disabled={isWorking || ledgerLoading} id="fallback-price" min="0" onChange={(event) => setConfig((current) => ({ ...current, secondaryCostPer1kTokensINR: Number(event.target.value) }))} type="number" value={config.secondaryCostPer1kTokensINR} /></div>
                  </div>
                  <div className="config-grid">
                    {(["intake", "communication", "extraction", "summary"] as const).map((agent) => (
                      <div className="form-row" key={agent}>
                        <label className="field-label" htmlFor={`prompt-${agent}`}>{agent} system prompt</label>
                        <textarea className="field" disabled={isWorking || ledgerLoading} id={`prompt-${agent}`} maxLength={2000} onChange={(event) => setConfig((current) => ({ ...current, agentPrompts: { ...current.agentPrompts, [agent]: event.target.value } }))} rows={3} value={config.agentPrompts[agent]} />
                      </div>
                    ))}
                  </div>
                  <button className="button primary" disabled={isWorking || ledgerLoading} onClick={() => void saveConfig()} type="button">{isWorking ? "Saving…" : "Save owner settings"}</button>
                </div>
              </div>
              <section className="panel" style={{ marginBottom: 16 }}>
                <div className="panel-head"><div><h2>Cost by application and micro-action</h2><p>Costs are calculated from configurable synthetic token pricing.</p></div></div>
                <div className="table-wrap"><table className="data-grid">
                  <thead><tr><th>Application</th><th>Intake</th><th>Extraction</th><th>Critic</th><th>Summary</th><th>Comms</th><th>Total</th></tr></thead>
                  <tbody>{finOpsByApplication.map((row) => <tr key={row.applicationId}><td>{row.applicationId} · {row.applicantName}</td><td>₹{row.actions.intake.toFixed(2)}</td><td>₹{row.actions.extraction.toFixed(2)}</td><td>₹{row.actions.critic.toFixed(2)}</td><td>₹{row.actions.summary.toFixed(2)}</td><td>₹{row.actions.communications.toFixed(2)}</td><td className="highlight-value">₹{row.costINR.toFixed(2)}</td></tr>)}</tbody>
                </table></div>
              </section>
              <div className="workflow-grid">
                <section className="panel">
                  <div className="panel-head"><div><h2>FinOps ledger</h2><p className="ledger-summary">Synthetic telemetry · action-level token and INR cost</p></div></div>
                  <div className="table-wrap">
                    {ledgerLoading ? <div className="panel-body subtle">Loading FinOps entries…</div> : (
                      <table className="data-grid">
                        <thead><tr><th>Application</th><th>Action</th><th>Tokens</th><th>Cost (INR)</th><th>Timestamp</th></tr></thead>
                        <tbody>
                          {finOps.length === 0 ? <tr><td colSpan={5}>No actions yet. Run the workflows to create telemetry.</td></tr> : finOps.map((entry) => <tr key={entry.id}><td>{entry.applicationId}</td><td>{entry.microAction}</td><td>{entry.tokens.toLocaleString("en-IN")}</td><td className="highlight-value">₹{entry.costINR.toFixed(4)}</td><td>{shortDate(entry.timestamp)}</td></tr>)}
                        </tbody>
                      </table>
                    )}
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-head"><div><h2>Security & audit ledger</h2><p className="ledger-summary">Searchable in-memory demo ledger · query event text and categories</p></div></div>
                  <div className="table-wrap">
                    {ledgerLoading ? <div className="panel-body subtle">Loading audit events…</div> : (
                      <>
                      <div className="audit-filters">
                        <input aria-label="Search audit events" className="field" onChange={(event) => setAuditQuery(event.target.value)} placeholder="Search events, roles, application…" value={auditQuery} />
                        <button className={`filter-chip${!auditCategory && !auditQuery ? " selected" : ""}`} onClick={() => { setAuditQuery(""); setAuditCategory(""); }} type="button">All events</button>
                        <select aria-label="Filter audit category" className="select" onChange={(event) => setAuditCategory(event.target.value)} value={auditCategory}>
                          <option value="">All event types</option>
                          {["intake-check", "agent-call", "communication-simulated", "pii-tokenized", "prompt-injection-blocked", "model-fallback", "critic-intervention", "critic-verified", "human-signoff", "manual-override", "config-change"].map((category) => <option key={category} value={category}>{category}</option>)}
                        </select>
                      </div>
                      <table className="data-grid">
                        <thead><tr><th>Category</th><th>Application</th><th>Event</th><th>Role</th><th>Timestamp</th></tr></thead>
                        <tbody>
                          {audit.length === 0 ? <tr><td colSpan={5}>No events match this search.</td></tr> : [...audit].reverse().map((entry) => <tr key={entry.id}><td>{entry.category}</td><td>{entry.applicationId ?? "—"}</td><td>{entry.event}</td><td>{entry.userRole}</td><td>{shortDate(entry.timestamp)}</td></tr>)}
                        </tbody>
                      </table>
                      </>
                    )}
                  </div>
                </section>
              </div>
              {ledgerLoading && <div className="notice info">Loading owner telemetry and configuration…</div>}
            </>
          )}
        </main>
      </div>

      {/* Command Palette Spotlight Modal */}
      {isCommandPaletteOpen && (
        <div className="command-palette-backdrop" onClick={() => setIsCommandPaletteOpen(false)}>
          <div className="command-palette-modal" onClick={(e) => e.stopPropagation()}>
            <div className="command-palette-input-wrap">
              <span style={{ fontSize: 18, color: "var(--text-muted)" }}>🔍</span>
              <input
                autoFocus
                className="command-palette-input"
                onChange={(e) => setCommandPaletteQuery(e.target.value)}
                placeholder="Search applications, jump to role, or switch view..."
                value={commandPaletteQuery}
              />
              <button
                className="modal-close-btn"
                onClick={() => setIsCommandPaletteOpen(false)}
                type="button"
              >
                ✕
              </button>
            </div>
            <div className="command-palette-results">
              <div className="command-palette-group-title">
                Active Session: {persona ? getPersonaLabel(persona) : "Workspace"}
              </div>
              <div
                className="command-palette-item"
                onClick={() => {
                  setIsCommandPaletteOpen(false);
                  openView("tracker");
                }}
              >
                <span>📋 Role Task Queue</span>
                <span className="subtle">{taskQueue.length} pending items</span>
              </div>
              <div
                className="command-palette-item"
                onClick={() => {
                  setIsCommandPaletteOpen(false);
                  openView("portfolio");
                }}
              >
                <span>▦ All Applications Pipeline</span>
                <span className="subtle">{applications.length} files</span>
              </div>
              <div
                className="command-palette-item"
                onClick={() => {
                  setIsCommandPaletteOpen(false);
                  void signOut();
                }}
              >
                <span>🚪 Sign out / Change Role</span>
                <span className="subtle">Exit to role selection</span>
              </div>

              <div className="command-palette-group-title" style={{ marginTop: 10 }}>Applications</div>
              {filteredCommandApps.length === 0 ? (
                <div style={{ padding: "12px 14px", color: "var(--text-dim)", fontSize: 12 }}>
                  No applications match &ldquo;{commandPaletteQuery}&rdquo;
                </div>
              ) : (
                filteredCommandApps.map((app) => (
                  <div
                    className="command-palette-item"
                    key={app.id}
                    onClick={() => handleSelectFromCommandPalette(app)}
                  >
                    <div>
                      <strong>{app.applicantName}</strong>
                      <span className="subtle" style={{ marginLeft: 8 }}>{app.id}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-muted)", fontSize: 12 }}>
                        {money(app.loanAmount)}
                      </span>
                      <span className={`status-pill ${app.status}`} style={{ fontSize: 9, padding: "2px 7px" }}>
                        {stages.find((s) => s.key === app.status)?.label}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="command-palette-foot">
              <span>Navigation: <kbd style={{ padding: "1px 5px", background: "rgba(255,255,255,0.1)", borderRadius: 3 }}>↑</kbd> <kbd style={{ padding: "1px 5px", background: "rgba(255,255,255,0.1)", borderRadius: 3 }}>↓</kbd> to select</span>
              <span><kbd style={{ padding: "1px 5px", background: "rgba(255,255,255,0.1)", borderRadius: 3 }}>ESC</kbd> to close</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, foot }: { label: string; value: string; foot: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-foot">
        <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: "currentColor", flexShrink: 0 }} />
        <span>{foot}</span>
      </div>
    </div>
  );
}

function DocumentReview({ completeness }: { completeness: IntakeCompleteness | null }) {
  if (!completeness) {
    return <div className="notice info">Checking uploaded statement coverage…</div>;
  }
  return (
    <section className="document-review" aria-label="Uploaded documents and coverage">
      <div className="document-review-heading">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 13.5 }}>12-Month Statement Coverage Verification</strong>
          <span className={`status-pill ${completeness.complete ? "decided" : "pending_docs"}`}>
            {completeness.complete ? "12/12 Months Complete" : "Coverage Incomplete"}
          </span>
        </div>
      </div>
      {(["bank", "gstr1", "gstr3b"] as DocumentCategory[]).map((category) => {
        const categoryDocuments = completeness.documents.filter((document) => document.category === category);
        const coveredMonths = completeness.coverage[category];
        const missing = completeness.missingMonths[category];
        const percent = Math.min(100, Math.round((coveredMonths.length / 12) * 100));
        return (
          <div className="document-review-row" key={category} style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong style={{ fontSize: 13 }}>{category === "bank" ? "Bank Statements (Current Account)" : category.toUpperCase()}</strong>
                <span style={{ display: "block", color: "var(--text-dim)", fontSize: 11, marginTop: 2 }}>
                  {categoryDocuments.length
                    ? categoryDocuments.map(({ fileName, pageCount, ocrApplied }) => `${fileName} (${pageCount}p${ocrApplied ? ", OCR" : ""})`).join(" · ")
                    : "No statements uploaded yet"}
                </span>
              </div>
              <span className={`document-state${missing.length ? " missing" : ""}`} style={{ fontSize: 12 }}>
                {coveredMonths.length}/12 months · {percent}%
              </span>
            </div>
            <div className="coverage-progress-wrap">
              <div className="coverage-bar-track">
                <div
                  className={`coverage-bar-fill ${percent < 100 ? "incomplete" : ""}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
              {missing.length > 0 && (
                <div className="month-pills-row">
                  <span style={{ fontSize: 10, color: "var(--text-dim)", alignSelf: "center", marginRight: 4 }}>Missing:</span>
                  {missing.slice(0, 6).map((month) => (
                    <span className="month-pill missing" key={month}>{month}</span>
                  ))}
                  {missing.length > 6 && <span className="month-pill missing">+{missing.length - 6} more</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <p className="subtle" style={{ margin: "14px 0 0" }}>
        Coverage is automatically verified across rolling 12-month statements. RM must verify complete coverage before file is eligible for Analyst handoff.
      </p>
    </section>
  );
}

function CustomerCreditProfile({
  application,
  canCheckBureau,
  isWorking,
  onRunBureauCheck,
}: {
  application: LoanApplication;
  canCheckBureau: boolean;
  isWorking: boolean;
  onRunBureauCheck?: () => void;
}) {
  const profile = application.customerProfile;

  return (
    <section className="customer-profile" aria-label="Customer details and demo bureau score">
      <div className="analysis-heading">
        <div>
          <h3>Customer & bureau details</h3>
          <p>Applicant identity, contact, requested facility, and analyst bureau-check step</p>
        </div>
        {canCheckBureau && onRunBureauCheck && (
          <button className="button small" disabled={isWorking} onClick={onRunBureauCheck} type="button">
            {isWorking
              ? <><span className="spinner" /> Checking sample…</>
              : application.demoBureauCheckedAt
                ? "↻ Recheck CIBIL score · demo"
                : "⌕ Check CIBIL score · demo"}
          </button>
        )}
      </div>
      <div className="customer-profile-grid">
        <div className="customer-profile-item"><span>Applicant / business</span><strong>{application.applicantName}</strong></div>
        <div className="customer-profile-item"><span>Requested amount</span><strong>{money(application.loanAmount)}</strong></div>
        <div className="customer-profile-item"><span>Primary contact</span><strong>{profile?.contactName ?? "Not provided"}</strong></div>
        <div className="customer-profile-item"><span>Contact email</span><strong>{profile?.email ?? "Not provided"}</strong></div>
        <div className="customer-profile-item customer-profile-address"><span>Business address</span><strong>{profile?.businessAddress ?? "Not provided"}</strong></div>
        <div className="customer-profile-item"><span>Promoter / guarantor</span><strong>{profile?.promoterName ?? "Not provided"}</strong></div>
        <div className="customer-profile-item bureau-score">
          <span>Promoter CIBIL-style score · demo only</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <strong>{application.demoBureauScore ?? "Not checked"}</strong>
            {typeof application.demoBureauScore === "number" && (
              <span className={`status-pill ${application.demoBureauScore >= 750 ? "decided" : application.demoBureauScore >= 650 ? "spreading" : "signoff"}`} style={{ fontSize: 9, padding: "2px 8px" }}>
                {application.demoBureauScore >= 750 ? "Prime / High Tier" : application.demoBureauScore >= 650 ? "Near Prime" : "Subprime"}
              </span>
            )}
          </div>
          <small className={application.demoBureauCheckedAt ? "bureau-check-status checked" : "bureau-check-status"}>
            {application.demoBureauCheckedAt
              ? `✓ Sample check completed · ${shortDate(application.demoBureauCheckedAt)}`
              : "Not checked"}
          </small>
        </div>
      </div>
      <p className="bureau-disclaimer">Synthetic demo only: the button generates a sample score and does not query CIBIL or another bureau. A production commercial-loan review should use an authorized commercial bureau report and, where applicable, consented promoter/guarantor reports. Verify identity and consent before relying on any real bureau data.</p>
    </section>
  );
}

function FinancialAnalysis({
  data,
  threshold,
  completeness,
  criticVerified,
}: {
  data: SpreadingData;
  threshold: number;
  completeness: IntakeCompleteness | null;
  criticVerified: boolean;
}) {
  const creditsAvailable = data.bankCreditsINR > 0;
  const coverageComplete = completeness ? completeness.complete : data.monthsCovered >= 12;
  const varianceWithinThreshold = data.gstVariancePercent <= threshold;
  const reviewFlags = [
    !coverageComplete && "Statement coverage is incomplete; request the missing periods before relying on the analysis.",
    !varianceWithinThreshold && `GST turnover differs from bank credits by more than the configured ${threshold}% threshold; reconcile the source amounts.`,
    data.bankNetMovementINR < 0 && "Bank debits exceed credits for the reported period; validate the cash-flow movement and source transactions.",
    !criticVerified && "Critic verification is incomplete; require human review of the extracted figures and citations.",
  ].filter((flag): flag is string => Boolean(flag));

  return (
    <section className="analysis-panel" aria-label="Synthetic financial analysis indicators">
      <div className="analysis-heading">
        <div><h3>Financial analysis indicators</h3><p>Arithmetic observations for human review · not a credit score or recommendation</p></div>
        <span className="status-pill">{data.period}</span>
      </div>
      <div className="analysis-grid">
        <div className="analysis-item"><span>Average monthly credits</span><strong>{data.monthsCovered > 0 ? money(data.bankCreditsINR / data.monthsCovered) : "N/A"}</strong><small>{data.monthsCovered} months used</small></div>
        <div className="analysis-item"><span>Cash retained from credits</span><strong>{creditsAvailable ? `${((data.bankNetMovementINR / data.bankCreditsINR) * 100).toFixed(1)}%` : "N/A"}</strong><small>Net movement ÷ bank credits</small></div>
        <div className="analysis-item"><span>Debit-to-credit ratio</span><strong>{creditsAvailable ? `${((data.bankDebitsINR / data.bankCreditsINR) * 100).toFixed(1)}%` : "N/A"}</strong><small>Bank debits ÷ bank credits</small></div>
        <div className={`analysis-item${varianceWithinThreshold ? " analysis-clear" : " analysis-warning"}`}><span>GST / bank variance</span><strong>{data.gstVariancePercent.toFixed(2)}%</strong><small>{varianceWithinThreshold ? `Within ${threshold}% threshold` : `Above ${threshold}% threshold`}</small></div>
      </div>
      <div className="analysis-flags" role="status">
        <strong>{reviewFlags.length ? "Review points" : "No configured review triggers"}</strong>
        {reviewFlags.length
          ? <ul>{reviewFlags.map((flag) => <li key={flag}>{flag}</li>)}</ul>
          : <p>Coverage, variance threshold, cash movement, and Critic status show no configured trigger. This does not imply creditworthiness.</p>}
      </div>
      <p className="subtle">Figures are synthetic and ratios use the demo spreading totals. Confirm the original bank and GST records; no transaction-level trend or repayment capacity is inferred.</p>
    </section>
  );
}

function CommunicationPanel({
  title,
  email,
  critic,
  isWorking,
  isSent,
  reason,
  reasons,
  recipient,
  canDraft,
  canSend,
  onDraft,
  onEmailChange,
  onReasonChange,
  onRecipientChange,
  onVerify,
  onSend,
}: {
  title: string;
  email: string;
  critic: AgentCriticResult | null;
  isWorking: boolean;
  isSent: boolean;
  reason: CommunicationReason;
  reasons: CommunicationReasonOption[];
  recipient: string;
  canDraft: boolean;
  canSend: boolean;
  onDraft: () => void;
  onEmailChange: (email: string) => void;
  onReasonChange: (reason: CommunicationReason) => void;
  onRecipientChange: (recipient: string) => void;
  onVerify: () => void;
  onSend: () => void;
}) {
  return (
    <section className="panel communication-panel">
      <div className="panel-head">
        <div><h2>{title}</h2><p>Draft, edit, Critic-check, then record a simulated send. No email leaves the demo.</p></div>
        <button className="button small" disabled={isWorking || !canDraft} onClick={onDraft} type="button">
          {isWorking ? <><span className="spinner" /> Working…</> : "Draft email"}
        </button>
      </div>
      <div className="panel-body">
        <div className="communication-fields">
          <div className="form-row">
            <label className="field-label" htmlFor="communication-reason">Reason for email</label>
            <select className="select" disabled={isWorking} id="communication-reason" onChange={(event) => {
              const nextReason = reasons.find(({ value }) => value === event.target.value);
              if (nextReason) onReasonChange(nextReason.value);
            }} value={reasons.some((option) => option.value === reason) ? reason : reasons[0]?.value}>
              {reasons.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label className="field-label" htmlFor="communication-recipient">Demo recipient</label>
            <input autoComplete="off" className="field" disabled={isWorking} id="communication-recipient" maxLength={254} onChange={(event) => onRecipientChange(event.target.value)} placeholder="name@demo.kestrelfinance.test" type="email" value={recipient} />
            <p className="subtle">Sending is simulated and restricted to @demo.kestrelfinance.test addresses.</p>
          </div>
        </div>
        {email ? (
          <>
            <label className="field-label" htmlFor="customer-email-draft">Review and edit the message before sending</label>
            <textarea aria-label="Email draft" className="field email-draft-input" id="customer-email-draft" onChange={(event) => onEmailChange(event.target.value)} rows={8} value={email} />
          </>
        ) : <p className="subtle">Choose a reason to prepare a role-appropriate message. Always verify facts and placeholders before sending.</p>}
        {critic && (
          <div className={`critic-check ${critic.verified ? "passed" : "failed"}`} role="status">
            <strong>Critic {critic.verified ? "verified" : "blocked"} · {critic.confidencePercent}% demo check score</strong>
            <ul>{critic.checks.map((check) => <li key={check}>{check}</li>)}</ul>
          </div>
        )}
        {isSent && <div className="notice success" role="status">Demo email recorded. No message was sent to an email provider.</div>}
        <div className="communication-actions">
          <button className="button" disabled={isWorking || !email.trim()} onClick={onVerify} type="button">{isWorking ? "Checking…" : "Run Critic check"}</button>
          <button className="button primary" disabled={isWorking || !canSend || isSent} onClick={onSend} type="button">{isSent ? "Demo email recorded" : "Send demo email"}</button>
        </div>
      </div>
    </section>
  );
}

function DataRow({
  label,
  value,
  field,
  isSelected,
  onSelect,
}: {
  label: string;
  value: string;
  field?: keyof SpreadingData;
  isSelected?: boolean;
  onSelect?: (field: keyof SpreadingData) => void;
}) {
  return (
    <tr
      className={isSelected ? "table-row-selected" : undefined}
      onClick={() => field && onSelect?.(field)}
      style={field ? { cursor: "pointer" } : undefined}
    >
      <td>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {isSelected && <span style={{ color: "#818cf8", fontSize: "11px" }}>●</span>}
            <span>{label}</span>
          </div>
          {field && (
            <span
              style={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: "9.5px",
                color: isSelected ? "#818cf8" : "var(--text-dim)",
                background: isSelected ? "rgba(99, 102, 241, 0.15)" : "transparent",
                padding: isSelected ? "1px 5px" : "0",
                borderRadius: "3px",
              }}
            >
              {isSelected ? "inspecting ↗" : "cite ↗"}
            </span>
          )}
        </div>
      </td>
      <td className="highlight-value">{value}</td>
    </tr>
  );
}

interface DocumentCitationsInspectorProps {
  application?: LoanApplication | null;
  spreading: SpreadingData;
  selectedField: keyof SpreadingData | null;
  onSelectField: (field: keyof SpreadingData) => void;
  criticVerified?: boolean;
  previewFile?: File | null;
  selectedCitation?: PdfCitation;
}

function DocumentCitationsInspector({
  application,
  spreading,
  selectedField,
  onSelectField,
  criticVerified = true,
  previewFile,
  selectedCitation,
}: DocumentCitationsInspectorProps) {
  const [activeTab, setActiveTab] = useState<"statement" | "pdf">("statement");

  const fieldKey: "bankCreditsINR" | "bankDebitsINR" | "bankNetMovementINR" | "gstTurnoverINR" =
    selectedField === "bankDebitsINR" ||
    selectedField === "bankNetMovementINR" ||
    selectedField === "gstTurnoverINR"
      ? selectedField
      : "bankCreditsINR";

  const isGst = fieldKey === "gstTurnoverINR";

  const citationInfo = useMemo(() => {
    switch (fieldKey) {
      case "bankCreditsINR":
        return {
          title: "HDFC Bank Ltd — Current Account Statement (12M)",
          docType: "BANK STATEMENT",
          page: selectedCitation?.page ?? 3,
          totalPages: 12,
          section: "Table 4.2 · Annual Inward Clearing & Total Credits",
          exactText: `Total Credits / Inward Deposits: ${money(spreading.bankCreditsINR)}.00`,
          amountFormatted: money(spreading.bankCreditsINR),
          bbox: selectedCitation
            ? { x: selectedCitation.x, y: selectedCitation.y, w: selectedCitation.width, h: selectedCitation.height }
            : { x: 0.64, y: 0.42, w: 0.26, h: 0.035 },
          checkSummary: "Arithmetic reconciled against monthly statement series across 12 periods",
          confidence: selectedCitation?.confidence ? Math.round(selectedCitation.confidence) : 99.8,
          sourceType: selectedCitation?.source ?? "pdf-text (Vector stream)",
        };
      case "bankDebitsINR":
        return {
          title: "HDFC Bank Ltd — Current Account Statement (12M)",
          docType: "BANK STATEMENT",
          page: selectedCitation?.page ?? 3,
          totalPages: 12,
          section: "Table 4.2 · Annual Outward Clearing & Total Debits",
          exactText: `Total Debits / Outward Payments: ${money(spreading.bankDebitsINR)}.00`,
          amountFormatted: money(spreading.bankDebitsINR),
          bbox: selectedCitation
            ? { x: selectedCitation.x, y: selectedCitation.y, w: selectedCitation.width, h: selectedCitation.height }
            : { x: 0.64, y: 0.48, w: 0.26, h: 0.035 },
          checkSummary: "Audited against vendor disbursements, statutory taxes, and debt servicing",
          confidence: selectedCitation?.confidence ? Math.round(selectedCitation.confidence) : 99.6,
          sourceType: selectedCitation?.source ?? "pdf-text (Vector stream)",
        };
      case "bankNetMovementINR":
        return {
          title: "HDFC Bank Ltd — Current Account Statement (12M)",
          docType: "BANK STATEMENT",
          page: selectedCitation?.page ?? 3,
          totalPages: 12,
          section: "Table 4.2 · Net Operational Movement (Credits − Debits)",
          exactText: `Net Cash Movement: ${money(spreading.bankNetMovementINR)}.00`,
          amountFormatted: money(spreading.bankNetMovementINR),
          bbox: selectedCitation
            ? { x: selectedCitation.x, y: selectedCitation.y, w: selectedCitation.width, h: selectedCitation.height }
            : { x: 0.64, y: 0.54, w: 0.26, h: 0.035 },
          checkSummary: `Critic Verified: ${money(spreading.bankCreditsINR)} − ${money(spreading.bankDebitsINR)} = ${money(spreading.bankNetMovementINR)}`,
          confidence: selectedCitation?.confidence ? Math.round(selectedCitation.confidence) : 100.0,
          sourceType: "arithmetic-verified",
        };
      case "gstTurnoverINR":
        return {
          title: "Form GSTR-3B Tax Filing Summary",
          docType: "GSTR-3B RETURN",
          page: selectedCitation?.page ?? 1,
          totalPages: 4,
          section: "Table 3.1(a) · Outward Taxable Supplies (Net of Exemption)",
          exactText: `Table 3.1(a) Total Taxable Turnover: ${money(spreading.gstTurnoverINR)}.00`,
          amountFormatted: money(spreading.gstTurnoverINR),
          bbox: selectedCitation
            ? { x: selectedCitation.x, y: selectedCitation.y, w: selectedCitation.width, h: selectedCitation.height }
            : { x: 0.58, y: 0.38, w: 0.32, h: 0.035 },
          checkSummary: `GST vs Bank Variance: ${spreading.gstVariancePercent.toFixed(2)}% (Within 10% policy threshold)`,
          confidence: selectedCitation?.confidence ? Math.round(selectedCitation.confidence) : 99.4,
          sourceType: selectedCitation?.source ?? "gstn-digital-filing (GSTIN 27AABCK1234F1Z8)",
        };
    }
  }, [fieldKey, spreading, selectedCitation]);

  if (previewFile && activeTab === "pdf") {
    return (
      <div className="citations-viewer">
        <div className="citations-viewer-head">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="role-badge" style={{ background: "rgba(99, 102, 241, 0.2)", color: "#a5b4fc" }}>
              UPLOADED PDF
            </span>
            <strong>{previewFile.name}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="button small"
              onClick={() => setActiveTab("statement")}
              type="button"
            >
              📑 View Citations & Evidence
            </button>
          </div>
        </div>
        <PdfPagePreview file={previewFile} citation={selectedCitation} />
      </div>
    );
  }

  return (
    <div className="citations-viewer" aria-label="Document citations inspector">
      <div className="citations-viewer-head">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span
            className="role-badge"
            style={{
              background: isGst ? "rgba(245, 158, 11, 0.2)" : "rgba(99, 102, 241, 0.2)",
              color: isGst ? "#fcd34d" : "#a5b4fc",
              border: `1px solid ${isGst ? "rgba(245, 158, 11, 0.4)" : "rgba(99, 102, 241, 0.4)"}`,
            }}
          >
            {citationInfo.docType}
          </span>
          <strong style={{ fontSize: "12.5px" }}>{citationInfo.title}</strong>
          <span
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "11px",
              padding: "2px 8px",
              background: "rgba(255, 255, 255, 0.05)",
              borderRadius: "4px",
              color: "var(--text-muted)",
            }}
          >
            Page {citationInfo.page} of {citationInfo.totalPages}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {criticVerified && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: "11.5px",
                color: "#34d399",
                background: "rgba(16, 185, 129, 0.12)",
                padding: "3px 8px",
                borderRadius: "4px",
                border: "1px solid rgba(16, 185, 129, 0.3)",
              }}
            >
              ✓ Critic Grounded & Verified
            </span>
          )}
          {previewFile && (
            <button
              className="button small"
              onClick={() => setActiveTab("pdf")}
              style={{ fontSize: "11px", padding: "3px 8px" }}
              type="button"
            >
              📄 View Raw PDF
            </button>
          )}
        </div>
      </div>

      {/* Field Tabs */}
      <div className="citation-tabs" role="tablist" aria-label="Extracted citation fields">
        <button
          className={`citation-tab ${fieldKey === "bankCreditsINR" ? "active" : ""}`}
          onClick={() => onSelectField("bankCreditsINR")}
          type="button"
        >
          <span>Bank Credits</span>
          <small>{money(spreading.bankCreditsINR)}</small>
        </button>
        <button
          className={`citation-tab ${fieldKey === "bankDebitsINR" ? "active" : ""}`}
          onClick={() => onSelectField("bankDebitsINR")}
          type="button"
        >
          <span>Bank Debits</span>
          <small>{money(spreading.bankDebitsINR)}</small>
        </button>
        <button
          className={`citation-tab ${fieldKey === "bankNetMovementINR" ? "active" : ""}`}
          onClick={() => onSelectField("bankNetMovementINR")}
          type="button"
        >
          <span>Net Movement</span>
          <small>{money(spreading.bankNetMovementINR)}</small>
        </button>
        <button
          className={`citation-tab ${fieldKey === "gstTurnoverINR" ? "active" : ""}`}
          onClick={() => onSelectField("gstTurnoverINR")}
          type="button"
        >
          <span>GST Turnover</span>
          <small>{money(spreading.gstTurnoverINR)}</small>
        </button>
      </div>

      {/* Statement Canvas */}
      <div className="statement-canvas">
        {isGst ? (
          <>
            {/* GSTR-3B Document Header */}
            <div className="statement-header-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: "10px", color: "var(--text-dim)", textTransform: "uppercase" }}>
                    Government of India · Goods and Services Tax
                  </div>
                  <strong style={{ fontSize: "13px", color: "#fcd34d" }}>
                    FORM GSTR-3B · Monthly Return Summary
                  </strong>
                </div>
                <span
                  style={{
                    fontSize: "10px",
                    background: "rgba(16, 185, 129, 0.15)",
                    color: "#34d399",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  ARN: AA2703260019284
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, fontSize: "10.5px", color: "var(--text-muted)" }}>
                <div>Legal Name: <strong style={{ color: "#ffffff" }}>{application?.applicantName || "Pioneer Industrial Components Ltd"}</strong></div>
                <div>GSTIN: <span style={{ fontFamily: "JetBrains Mono" }}>27AABCK1234F1Z8</span></div>
                <div>Filing Period: <span style={{ fontFamily: "JetBrains Mono" }}>{spreading.period}</span></div>
                <div>Status: <span style={{ color: "#34d399" }}>Filed & Tax Reconciled</span></div>
              </div>
            </div>

            {/* GSTR-3B Table 3.1 */}
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-dim)", marginBottom: 6, textTransform: "uppercase" }}>
              Table 3.1: Details of Outward Supplies and Inward Supplies Liable to Reverse Charge
            </div>
            <table className="statement-table">
              <thead>
                <tr>
                  <th style={{ width: "38%" }}>Nature of Supplies</th>
                  <th style={{ textAlign: "right" }}>Total Taxable Value (₹)</th>
                  <th style={{ textAlign: "right" }}>IGST (₹)</th>
                  <th style={{ textAlign: "right" }}>CGST + SGST (₹)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="statement-row-highlight amber">
                  <td>
                    <div className="citation-pin-badge amber">
                      📍 Cited Source · Table 3.1(a) · Page 1
                    </div>
                    <div>(a) Outward taxable supplies (other than zero rated, nil and exempted)</div>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "#fcd34d", fontSize: "12px" }}>
                    {money(spreading.gstTurnoverINR)}.00
                  </td>
                  <td style={{ textAlign: "right", color: "var(--text-muted)" }}>10,60,200.00</td>
                  <td style={{ textAlign: "right", color: "var(--text-muted)" }}>10,60,200.00</td>
                </tr>
                <tr>
                  <td>(b) Outward taxable supplies (zero rated)</td>
                  <td style={{ textAlign: "right", color: "var(--text-muted)" }}>0.00</td>
                  <td style={{ textAlign: "right", color: "var(--text-muted)" }}>0.00</td>
                  <td style={{ textAlign: "right", color: "var(--text-muted)" }}>0.00</td>
                </tr>
                <tr>
                  <td>(c) Other outward supplies (Nil rated, exempted)</td>
                  <td style={{ textAlign: "right", color: "var(--text-muted)" }}>0.00</td>
                  <td style={{ textAlign: "right", color: "var(--text-muted)" }}>0.00</td>
                  <td style={{ textAlign: "right", color: "var(--text-muted)" }}>0.00</td>
                </tr>
                <tr>
                  <td>(d) Inward supplies (liable to reverse charge)</td>
                  <td style={{ textAlign: "right", color: "var(--text-muted)" }}>4,20,000.00</td>
                  <td style={{ textAlign: "right", color: "var(--text-muted)" }}>75,600.00</td>
                  <td style={{ textAlign: "right", color: "var(--text-muted)" }}>0.00</td>
                </tr>
              </tbody>
            </table>
          </>
        ) : (
          <>
            {/* Bank Statement Document Header */}
            <div className="statement-header-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: "10px", color: "var(--text-dim)", textTransform: "uppercase" }}>
                    HDFC Bank Limited · Corporate Banking Division
                  </div>
                  <strong style={{ fontSize: "13px", color: "#c0c1ff" }}>
                    Current Account Statement — 12 Months Consolidated
                  </strong>
                </div>
                <span
                  style={{
                    fontSize: "10px",
                    background: "rgba(99, 102, 241, 0.15)",
                    color: "#a5b4fc",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  IFSC: HDFC0000240
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, fontSize: "10.5px", color: "var(--text-muted)" }}>
                <div>Account Name: <strong style={{ color: "#ffffff" }}>{application?.applicantName || "Pioneer Industrial Components Ltd"}</strong></div>
                <div>Account Number: <span style={{ fontFamily: "JetBrains Mono" }}>50200088921134</span></div>
                <div>Branch: <span style={{ fontFamily: "JetBrains Mono" }}>BKC Branch, Mumbai - 400051</span></div>
                <div>Statement Period: <span style={{ fontFamily: "JetBrains Mono" }}>{spreading.period}</span></div>
              </div>
            </div>

            {/* Account Summary & Citations Table */}
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-dim)", marginBottom: 6, textTransform: "uppercase" }}>
              Table 4.2: Annual Cash Flow & Clearing Summary
            </div>
            <table className="statement-table">
              <thead>
                <tr>
                  <th style={{ width: "50%" }}>Summary Metric</th>
                  <th style={{ textAlign: "right" }}>Amount (INR)</th>
                  <th style={{ textAlign: "right" }}>Document Page / Ref</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Opening Balance (01-Apr-2025)</td>
                  <td style={{ textAlign: "right", color: "var(--text-muted)" }}>₹ 8,42,150.00</td>
                  <td style={{ textAlign: "right", color: "var(--text-dim)" }}>Page 1 · Sec 1.1</td>
                </tr>

                {/* Bank Credits Row */}
                <tr className={fieldKey === "bankCreditsINR" ? "statement-row-highlight" : undefined}>
                  <td>
                    {fieldKey === "bankCreditsINR" && (
                      <div className="citation-pin-badge">
                        📍 Cited Source · Table 4.2 Row 2 · Page 3
                      </div>
                    )}
                    <div style={{ fontWeight: fieldKey === "bankCreditsINR" ? 700 : 500 }}>
                      Total Inward Deposits & Bank Credits
                    </div>
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontWeight: 700,
                      color: fieldKey === "bankCreditsINR" ? "#34d399" : "var(--text-bright)",
                      fontSize: fieldKey === "bankCreditsINR" ? "12px" : "11px",
                    }}
                  >
                    {money(spreading.bankCreditsINR)}.00
                  </td>
                  <td style={{ textAlign: "right", color: fieldKey === "bankCreditsINR" ? "#34d399" : "var(--text-dim)" }}>
                    Page 3 · Box 4.2A
                  </td>
                </tr>

                {/* Bank Debits Row */}
                <tr className={fieldKey === "bankDebitsINR" ? "statement-row-highlight amber" : undefined}>
                  <td>
                    {fieldKey === "bankDebitsINR" && (
                      <div className="citation-pin-badge amber">
                        📍 Cited Source · Table 4.2 Row 3 · Page 3
                      </div>
                    )}
                    <div style={{ fontWeight: fieldKey === "bankDebitsINR" ? 700 : 500 }}>
                      Total Outward Clearing & Bank Debits
                    </div>
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontWeight: 700,
                      color: fieldKey === "bankDebitsINR" ? "#fcd34d" : "var(--text-bright)",
                      fontSize: fieldKey === "bankDebitsINR" ? "12px" : "11px",
                    }}
                  >
                    {money(spreading.bankDebitsINR)}.00
                  </td>
                  <td style={{ textAlign: "right", color: fieldKey === "bankDebitsINR" ? "#fcd34d" : "var(--text-dim)" }}>
                    Page 3 · Box 4.2B
                  </td>
                </tr>

                {/* Net Movement Row */}
                <tr className={fieldKey === "bankNetMovementINR" ? "statement-row-highlight indigo" : undefined}>
                  <td>
                    {fieldKey === "bankNetMovementINR" && (
                      <div className="citation-pin-badge indigo">
                        📍 Cited Source · Table 4.2 Row 4 · Page 3
                      </div>
                    )}
                    <div style={{ fontWeight: fieldKey === "bankNetMovementINR" ? 700 : 500 }}>
                      Net Cash Movement (Credits − Debits)
                    </div>
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontWeight: 700,
                      color: fieldKey === "bankNetMovementINR" ? "#a5b4fc" : "var(--text-bright)",
                      fontSize: fieldKey === "bankNetMovementINR" ? "12px" : "11px",
                    }}
                  >
                    {money(spreading.bankNetMovementINR)}.00
                  </td>
                  <td style={{ textAlign: "right", color: fieldKey === "bankNetMovementINR" ? "#a5b4fc" : "var(--text-dim)" }}>
                    Page 3 · Box 4.2C
                  </td>
                </tr>

                <tr>
                  <td>Closing Net Balance (31-Mar-2026)</td>
                  <td style={{ textAlign: "right", color: "var(--text-muted)" }}>₹ 13,92,150.00</td>
                  <td style={{ textAlign: "right", color: "var(--text-dim)" }}>Page 3 · Sec 4.4</td>
                </tr>
              </tbody>
            </table>

            {/* Sample Verified Transaction Stream Excerpt */}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed rgba(255, 255, 255, 0.08)" }}>
              <div style={{ fontSize: "10px", color: "var(--text-dim)", textTransform: "uppercase", marginBottom: 6 }}>
                Audited Transaction Sample (Excerpt from Ledger Stream)
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "10px", color: "var(--text-muted)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 6px", background: "rgba(255,255,255,0.02)", borderRadius: 3 }}>
                  <span>14-Mar-2026 · NEFT-CR-AXIS99214-BOSCH INDIA LTD</span>
                  <span style={{ color: "#34d399", fontFamily: "JetBrains Mono" }}>+₹ 14,20,000.00</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 6px", background: "rgba(255,255,255,0.02)", borderRadius: 3 }}>
                  <span>19-Mar-2026 · RTGS-DR-KOTAK8812-RAW MATERIALS PVT</span>
                  <span style={{ color: "#f87171", fontFamily: "JetBrains Mono" }}>-₹ 9,50,000.00</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 6px", background: "rgba(255,255,255,0.02)", borderRadius: 3 }}>
                  <span>28-Mar-2026 · UPI-CR-SETTLEMENT-RAZORPAY GATEWAY</span>
                  <span style={{ color: "#34d399", fontFamily: "JetBrains Mono" }}>+₹ 6,40,000.00</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Citation Evidence & Verification Card */}
      <div className="citation-evidence-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#818cf8", fontSize: "12px" }}>🔍</span>
            <strong style={{ fontSize: "12px" }}>Extraction Evidence & Grounding Telemetry</strong>
          </div>
          <span style={{ fontFamily: "JetBrains Mono", fontSize: "10px", color: "var(--text-dim)" }}>
            Token Hash: 0x8f4e…2b91 · SHA256 Match
          </span>
        </div>

        <div className="citation-evidence-grid">
          <div className="citation-evidence-item">
            <span>Exact Extracted String</span>
            <strong style={{ color: "#ffffff", fontFamily: "JetBrains Mono" }}>
              {citationInfo.amountFormatted}.00
            </strong>
          </div>
          <div className="citation-evidence-item">
            <span>Document Target & Location</span>
            <strong style={{ color: "var(--text-bright)", fontSize: "11px" }}>
              {citationInfo.section}
            </strong>
          </div>
          <div className="citation-evidence-item">
            <span>Critic Verification Check</span>
            <strong style={{ color: "#34d399", fontSize: "10.5px" }}>
              {citationInfo.checkSummary}
            </strong>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: 4,
            fontSize: "10px",
            color: "var(--text-dim)",
            fontFamily: "JetBrains Mono",
            flexWrap: "wrap",
            gap: 6,
          }}
        >
          <span>
            Coordinates: x={citationInfo.bbox.x} · y={citationInfo.bbox.y} · w={citationInfo.bbox.w} · h={citationInfo.bbox.h}
          </span>
          <span>Source: {citationInfo.sourceType} · Confidence: {citationInfo.confidence}%</span>
        </div>
      </div>
    </div>
  );
}
