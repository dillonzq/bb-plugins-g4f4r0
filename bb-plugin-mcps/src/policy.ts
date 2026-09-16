import type { JsonRecord, ToolPolicyMode, ToolRisk } from "./types.js";

export function classifyTool(annotations: JsonRecord | undefined): ToolRisk {
  if (annotations?.destructiveHint === true) return "destructive";
  if (annotations?.readOnlyHint === true) return "read";
  return "write";
}

export function resolvePolicyMode(risk: ToolRisk, mode: ToolPolicyMode, confirmWrites: boolean): "allow" | "deny" | "confirm" {
  if (mode === "allow" || mode === "deny" || mode === "confirm") return mode;
  if (risk === "destructive") return "confirm";
  if (risk === "write" && confirmWrites) return "confirm";
  return "allow";
}

export interface PolicyDecision {
  allowed: boolean;
  needsConfirm: boolean;
  risk: ToolRisk;
  reason?: string;
}

export function decideToolCall(options: {
  serverEnabled: boolean;
  toolEnabled: boolean;
  risk: ToolRisk;
  mode: ToolPolicyMode;
  confirmWrites: boolean;
  confirmed: boolean;
}): PolicyDecision {
  if (!options.serverEnabled) return { allowed: false, needsConfirm: false, risk: options.risk, reason: "MCP server is disabled" };
  if (!options.toolEnabled) return { allowed: false, needsConfirm: false, risk: options.risk, reason: "MCP tool is disabled" };
  const resolved = resolvePolicyMode(options.risk, options.mode, options.confirmWrites);
  if (resolved === "deny") return { allowed: false, needsConfirm: false, risk: options.risk, reason: "MCP tool is denied by policy" };
  if (resolved === "confirm" && !options.confirmed) {
    return { allowed: false, needsConfirm: true, risk: options.risk, reason: `MCP tool is ${options.risk}; pass confirm=true after the user agrees` };
  }
  return { allowed: true, needsConfirm: false, risk: options.risk };
}
