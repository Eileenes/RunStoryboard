import type { ParseResult } from "../types";
import { StepList, asNumber, asString, condense, summarizeArgs, tryParse } from "./common";

/**
 * Generic JSONL parser for any agent transcript.
 *
 * Heuristics per line (order matters):
 *   1. role + content                       -> user / assistant message
 *   2. tool/name + arguments|input          -> tool call
 *   3. tool_result/observation/output       -> tool result (attached)
 *   4. anything else JSON                   -> system step
 *   5. not JSON                             -> warning, skipped
 */

export function parseGeneric(raw: string): ParseResult {
  const list = new StepList();
  const warnings: string[] = [];
  const lines = raw.split("\n");
  let firstUser: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim().length === 0) continue;
    const obj = tryParse(line);
    if (obj === null) {
      warnings.push(`line ${i + 1}: not valid JSON, skipped`);
      continue;
    }

    const role = asString(obj.role);
    const ts = asNumber(asNumber(obj.timestamp) ?? asNumber(obj.ts) ?? asNumber(obj.time)) || undefined;

    // 1. role-bearing message
    if (role === "user" || role === "assistant" || role === "human" || role === "ai") {
      const text = textOf(obj.content);
      if (text.trim().length === 0) continue;
      const isUser = role === "user" || role === "human";
      if (isUser && firstUser === undefined) firstUser = condense(text);
      list.push({
        kind: isUser ? "user" : "assistant_text",
        title: isUser ? "user" : "assistant",
        detail: condense(text),
        status: "info",
        ts,
      });
      continue;
    }

    // 2. tool call (a call line may already carry its own error flag)
    const toolName = asString(obj.tool) ?? asString(obj.tool_name) ?? asString(obj.name) ?? asString(obj.toolName);
    const hasArgs = "arguments" in obj || "input" in obj || "args" in obj || "parameters" in obj;
    if (toolName !== undefined && hasArgs && obj.result === undefined && obj.output === undefined) {
      const args = obj.arguments ?? obj.input ?? obj.args ?? obj.parameters;
      const callError = obj.is_error === true || obj.error !== undefined || obj.status === "error";
      list.push({
        kind: "tool",
        title: toolName,
        tool: toolName,
        argsSummary: summarizeArgs(args),
        status: callError ? "error" : "info",
        ts,
      });
      continue;
    }

    // 3. tool result
    const resultVal = obj.result ?? obj.output ?? obj.observation;
    const isError = obj.is_error === true || obj.error !== undefined || obj.status === "error";
    if (resultVal !== undefined || isError) {
      const status: "ok" | "error" = isError ? "error" : "ok";
      const text = typeof resultVal === "string" ? resultVal : resultVal !== undefined ? JSON.stringify(resultVal) : asString(obj.error) ?? "";
      const attached = list.attachResult(undefined, status, condense(text, 160) || undefined);
      if (!attached) {
        warnings.push(`line ${i + 1}: result without matching tool call`);
        list.push({ kind: "tool", title: "orphan_result", resultDetail: condense(text, 160) || undefined, status, ts });
      }
      continue;
    }

    // 4. fallback: system-ish line
    const text = textOf(obj.content ?? obj.message ?? obj.text);
    list.push({
      kind: "system",
      title: asString(obj.type) ?? asString(obj.event) ?? "system",
      detail: text ? condense(text, 120) : condense(JSON.stringify(obj), 120),
      status: "info",
      ts,
    });
  }

  return {
    storyboard: { title: firstUser ? condense(firstUser, 70) : "Agent run", steps: list.finish(), stats: emptyStats(), annotations: [] },
    warnings,
  };
}

function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v
      .map((c) => {
        if (c === null || typeof c !== "object") return typeof c === "string" ? c : "";
        const o = c as Record<string, unknown>;
        return asString(o.text) ?? asString(o.content) ?? "";
      })
      .join(" ");
  }
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return asString(o.text) ?? "";
  }
  return "";
}

export function emptyStats() {
  return {
    totalSteps: 0,
    userMessages: 0,
    assistantTexts: 0,
    toolCalls: 0,
    errors: 0,
    retries: 0,
    loopSuspects: 0,
    parallelGroups: 0,
    durationMs: null as number | null,
    tokens: null as number | null,
    format: "generic",
  };
}
