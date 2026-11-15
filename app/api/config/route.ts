import { recordAudit, systemConfig } from "../../../lib/store";
import { isRecord } from "../../../lib/request";
import { containsCreditRecommendation, scanPromptInjection } from "../../../lib/guardrails";
import type { SystemConfig } from "../../../lib/types";

export const dynamic = "force-dynamic";

const promptKeys = ["intake", "communication", "extraction", "summary"] as const;

export async function GET(): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return Response.json(systemConfig);
}

export async function POST(request: Request): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 1500));

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isRecord(update)) {
    return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  const nextConfig: SystemConfig = {
    ...systemConfig,
    agentPrompts: { ...systemConfig.agentPrompts },
  };
  if (update.activeModel !== undefined) {
    if (typeof update.activeModel !== "string" || update.activeModel.trim() === "") {
      return Response.json({ error: "activeModel must be a non-empty string." }, { status: 400 });
    }
    nextConfig.activeModel = update.activeModel.trim();
  }
  if (update.fallbackModel !== undefined) {
    if (typeof update.fallbackModel !== "string" || update.fallbackModel.trim() === "") {
      return Response.json({ error: "fallbackModel must be a non-empty string." }, { status: 400 });
    }
    nextConfig.fallbackModel = update.fallbackModel.trim();
  }
  if (update.tone !== undefined) {
    if (!["professional", "concise", "warm"].includes(String(update.tone))) {
      return Response.json({ error: "tone must be professional, concise, or warm." }, { status: 400 });
    }
    nextConfig.tone = update.tone as SystemConfig["tone"];
  }
  if (update.temperature !== undefined) {
    if (typeof update.temperature !== "number" || update.temperature < 0 || update.temperature > 1) {
      return Response.json({ error: "temperature must be between 0 and 1." }, { status: 400 });
    }
    nextConfig.temperature = update.temperature;
  }
  for (const key of ["gstVarianceThreshold", "unitCostPer1kTokensINR", "secondaryCostPer1kTokensINR"] as const) {
    const value = update[key];
    if (value !== undefined) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (key === "gstVarianceThreshold" && value > 100)) {
        return Response.json({ error: `${key} has an invalid value.` }, { status: 400 });
      }
      nextConfig[key] = value;
    }
  }
  if (update.agentPrompts !== undefined) {
    if (!isRecord(update.agentPrompts)) {
      return Response.json({ error: "agentPrompts must be an object." }, { status: 400 });
    }
    for (const key of promptKeys) {
      const prompt = update.agentPrompts[key];
      if (prompt !== undefined) {
        if (typeof prompt !== "string" || prompt.trim().length < 10 || prompt.length > 2000) {
          return Response.json({ error: `${key} prompt must contain 10-2000 characters.` }, { status: 400 });
        }
        if (scanPromptInjection(prompt) || containsCreditRecommendation(prompt)) {
          return Response.json({ error: `${key} prompt contains prohibited instruction or credit-decision language.` }, { status: 400 });
        }
        nextConfig.agentPrompts[key] = prompt.trim();
      }
    }
  }

  Object.assign(systemConfig, nextConfig);
  systemConfig.agentPrompts = { ...nextConfig.agentPrompts };
  recordAudit({
    category: "config-change",
    event: `Owner updated model, prompt, or policy settings`,
    userRole: "Owner",
    details: {
      activeModel: systemConfig.activeModel,
      fallbackModel: systemConfig.fallbackModel,
      gstVarianceThreshold: systemConfig.gstVarianceThreshold,
      tone: systemConfig.tone,
    },
  });
  return Response.json(systemConfig);
}
