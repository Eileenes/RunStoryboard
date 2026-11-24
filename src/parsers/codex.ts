import type { ParseResult } from "../types";
import { LONG_OUTPUT_THRESHOLD } from "../types";
import { StepList, asNumber, asString, condense, summarizeArgs, tryParse } from "./common";

/**
 * Codex CLI session parser.
 *
 * Codex writes rollout files under `~/.codex/sessions/.../rollout-*.jsonl`:
 *   { timestamp, type: "session_meta" | "response_item" | "event_msg"
 *           | "turn_context" | "compacted", payload: {...} }
 * response_item payloads:
 *   { type: "message", role, content: [{ type: "input_text"|"output_text", text }] }
 *   { type: "function_call", name, arguments, call_id }
 *   { type: "function_call_output", call_id, output }
 *   { type: "reasoning", ... }  (not rendered)
 *
 * The parser is deliberately tolerant: unknown shapes become warnings, never
 * crashes — session files evolve between Codex versions.
 */

interface ContentItem {
  type?: string;
  text?: string;
}

export function parseCodex(raw: string): ParseResult {
  const list = new StepList();
  const warnings: string[] = [];
  const lines = raw.split("\n");
  const callIdToTool = new Map<string, string>();
  let firstUser: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim().length === 0) continue;
    const obj = tryParse(line);
    if (obj === null) {
      warnings.push(`line ${i + 1}: not valid JSON, skipped`);
      continue;
    }
    const ts = asNumber(Date.parse(asString(obj.timestamp) ?? "")) || undefined;
    const type = asString(obj.type) ?? "";
    const payload = obj.payload;

    if (type === "session_meta") {
      const id = payload !== null && typeof payload === "object" ? asString((payload as Record<string, unknown>).id) : undefined;
      list.push({ kind: "system", title: "session", detail: id ? condense(id, 60) : undefined, status: "info", ts });
      continue;
    }
    if (type === "event_msg" || type === "turn_context" || type === "compacted") {
      continue; // progress noise: token counts, heartbeats, context windows
    }
    if (type !== "response_item" || payload === null || typeof payload !== "object") {
      warnings.push(`line ${i + 1}: unknown type "${type}", skipped`);
      continue;
    }

    const p = payload as Record<string, unknown>;
    const ptype = asString(p.type) ?? "";

    if (ptype === "message") {
      const role = asString(p.role) ?? "user";
      const text = contentText(p.content);
      if (text.trim().length === 0) continue;
      if (role === "assistant") {
        list.push({ kind: "assistant_text", title: "assistant", detail: condense(text), status: "info", ts, longOutput: text.length > LONG_OUTPUT_THRESHOLD || undefined });
      } else if (role === "user") {
        if (firstUser === undefined) firstUser = condense(text);
        list.push({ kind: "user", title: "user", detail: condense(text), status: "info", ts });
      } else {
        // system / developer roles: context plumbing, not part of the visible run
        continue;
      }
    } else if (ptype === "function_call") {
      const name = asString(p.name) ?? "unknown_tool";
      if (typeof p.call_id === "string") callIdToTool.set(p.call_id, name);
      let argsSummary: string | undefined;
      const rawArgs = asString(p.arguments);
      if (rawArgs !== undefined) {
        const parsed = tryParse(rawArgs);
        argsSummary = parsed ? summarizeArgs(parsed) : summarizeArgs(rawArgs);
      }
      list.push({ kind: "tool", title: name, tool: name, argsSummary, status: "info", ts });
    } else if (ptype === "function_call_output") {
      const callId = asString(p.call_id);
      const name = callId !== undefined ? callIdToTool.get(callId) : undefined;
      let status: "ok" | "error" = "ok";
      let text = "";
      const out = p.output;
      if (typeof out === "string") text = out;
      else if (out !== null && typeof out === "object") {
        const o = out as Record<string, unknown>;
        if (o.type === "function_call_error" || o.is_error === true) status = "error";
        text = asString(o.message) ?? asString(o.output) ?? asString(o.content) ?? JSON.stringify(o);
      }
      const attached = list.attachResult(name, status, condense(text, 160) || undefined);
      if (!attached) {
        warnings.push(`line ${i + 1}: function_call_output without matching call (${callId ?? "?"})`);
        list.push({ kind: "tool", title: name ?? "orphan_result", tool: name, resultDetail: condense(text, 160) || undefined, status });
      }
    } else if (ptype === "reasoning" || ptype === "local_shell_call") {
      continue;
    } else {
      warnings.push(`line ${i + 1}: unknown response_item type "${ptype}", skipped`);
    }
  }

  return {
    storyboard: { title: firstUser ? condense(firstUser, 70) : "Codex session", steps: list.finish(), stats: emptyStats(), annotations: [] },
    warnings,
  };
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c !== null && typeof c === "object" ? asString((c as ContentItem).text) ?? "" : ""))
      .join(" ");
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
    format: "codex",
  };
}
