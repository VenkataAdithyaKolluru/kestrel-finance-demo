"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  ExtractionResult,
  FinOpsEntry,
  LoanApplication,
  SpreadingData,
} from "../lib/types";

type ApplicationColumns = Record<LoanApplication["status"], LoanApplication[]>;

interface KanbanRenderState {
  applications: LoanApplication[];
  columns: ApplicationColumns;
  isLoading: boolean;
  error: string | null;
}

interface KanbanIntegrationProps {
  children: (state: KanbanRenderState) => ReactNode;
}

interface ExtractionRenderState {
  data: SpreadingData | null;
  isLoading: boolean;
  error: string | null;
  runExtraction: () => Promise<void>;
}

interface AnalystIntegrationProps {
  applicationId: string;
  children: (state: ExtractionRenderState) => ReactNode;
}

interface FinOpsRenderState {
  entries: FinOpsEntry[];
  isLoading: boolean;
  error: string | null;
}

interface OwnerIntegrationProps {
  children: (state: FinOpsRenderState) => ReactNode;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const result = (await response.json()) as { error?: string };
    throw new Error(result.error ?? `Request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

export function KanbanIntegration({ children }: KanbanIntegrationProps) {
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<LoanApplication[]>("/api/applications", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(setApplications)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Could not load applications.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, []);

  const columns = useMemo<ApplicationColumns>(
    () => ({
      intake: applications.filter(({ status }) => status === "intake"),
      pending_docs: applications.filter(({ status }) => status === "pending_docs"),
      spreading: applications.filter(({ status }) => status === "spreading"),
      signoff: applications.filter(({ status }) => status === "signoff"),
      decided: applications.filter(({ status }) => status === "decided"),
    }),
    [applications],
  );

  return children({ applications, columns, isLoading, error });
}

export function AnalystIntegration({ applicationId, children }: AnalystIntegrationProps) {
  const [data, setData] = useState<SpreadingData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runExtraction(): Promise<void> {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchJson<ExtractionResult>(
        "/api/extract",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ applicationId }),
        },
      );
      setData(result);
      if (result.fallbackUsed) {
        setError("Fallback data is shown for manual review.");
      }
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Extraction failed.");
    } finally {
      setIsLoading(false);
    }
  }

  return children({ data, isLoading, error, runExtraction });
}

export function OwnerFinOpsIntegration({ children }: OwnerIntegrationProps) {
  const [entries, setEntries] = useState<FinOpsEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<{ entries: FinOpsEntry[] }>("/api/finops", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(({ entries: ledgerEntries }) => setEntries(ledgerEntries))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Could not load FinOps entries.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, []);

  return children({ entries, isLoading, error });
}
