import type { ParseResult, Step, StepStatus } from "../types";
import { LONG_OUTPUT_THRESHOLD } from "../types";
import { StepList, asNumber, asString, condense, summarizeArgs, tryParse } from "./common";

/**
 * Claude Code session transcript parser.
 *
 * Claude Code writes one JSON object per line to
 * `~/.claude/projects/<project>/<session>.jsonl`. Relevant shapes:
 *   { type: "user" | "assistant", message: { role, content: string | Block[] },
 *     timestamp, ... }
 * Blocks: { type: "text", text } | { type: "tool_use", id, name, input } |
 *         { type: "tool_result", tool_use_id, content, is_error }
 * System-ish lines: { type: "summary", summary } | { type: "system", ... }.
 *
 * Design decision: a tool_result block is merged back into the tool_call card
 * it answers (matched by tool_use_id). One call = one card = one status.
 * Orphan results become their own cards with a warning.
 */

interface Block {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  thought?: boolean;
}

function isBlockArray(v: unknown): v is Block[] {
  return Array.isArray(v) && v.every((b) => b !== null && typeof b === "object");
}

function resultOf(block: Block): { status: StepStatus; text: string } {
  const err = block.is_error === true;
  let text = "";
  const c = block.content;
  if (typeof c === "string") text = c;
  else if (isBlockArray(c)) text = c.map((b) => asString(b.text) ?? "").join(" ");
  else if (c !== undefined && c !== null) text = JSON.stringify(c);
  return { status: err ? "error" : "ok", text: condense(text, 160) };
}

export function parseClaude(raw: string): ParseResult {
  const list = new StepList();
  const warnings: string[] = [];
  const lines = raw.split("\n");
  const idToTool = new Map<string, string>(); // tool_use_id -> tool name
  let firstUser: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim().length === 0) continue;
    const obj = tryParse(line);
    if (obj === null) {
      warnings.push(`line ${i + 1}: not valid JSON, skipped`);
      continue;
    }
    const type = asString(obj.type) ?? "";
    const ts = asNumber(Date.parse(asString(obj.timestamp) ?? "")) || undefined;

    if (type === "user" || type === "assistant") {
      parseMessage(obj, type, ts, list, idToTool, warnings, (detail) => {
        if (firstUser === undefined && detail) firstUser = detail;
      });
    } else if (type === "summary") {
      const s = asString(obj.summary);
      if (s) list.push({ kind: "system", title: "summary", detail: condense(s, 120), status: "info" });
    } else if (type === "system" || type === "result") {
      list.push({ kind: "system", title: type, detail: condense(line, 120), status: "info" });
    } else {
      warnings.push(`line ${i + 1}: unknown type "${type}", skipped`);
    }
  }

  return { storyboard: { title: firstUser ? condense(firstUser, 70) : "Agent run", steps: list.finish(), stats: emptyStats(), annotations: [] }, warnings };
}

function parseMessage(
  obj: Record<string, unknown>,
  type: "user" | "assistant",
  ts: number | undefined,
  list: StepList,
  idToTool: Map<string, string>,
  warnings: string[],
  onFirstUser: (detail: string) => void,
): void {
  const msg = obj.message;
  if (msg === null || typeof msg !== "object") {
    list.push({ kind: type === "user" ? "user" : "unknown", title: type, detail: condense(JSON.stringify(obj), 120), status: "info", ts });
    return;
  }
  const m = msg as Record<string, unknown>;
  const content = m.content;

  if (typeof content === "string") {
    if (type === "user") onFirstUser(condense(content));
    list.push({ kind: "user" === type ? "user" : "assistant_text", title: type === "user" ? "user" : "assistant", detail: condense(content), status: "info", ts });
    return;
  }
  if (!isBlockArray(content)) {
    list.push({ kind: type === "user" ? "user" : "unknown", title: type, detail: condense(JSON.stringify(m), 120), status: "info", ts });
    return;
  }

  const toolUses = content.filter((b) => b.type === "tool_use");
  let toolIdx = 0;

  for (const block of content) {
    const bt = block.type ?? "";
    if (bt === "text") {
      const text = asString(block.text) ?? "";
      if (text.trim().length === 0) continue;
      if (type === "user") {
        onFirstUser(condense(text));
        list.push({ kind: "user", title: "user", detail: condense(text), status: "info", ts });
      } else {
        list.push({ kind: "assistant_text", title: "assistant", detail: condense(text), status: "info", ts, longOutput: text.length > LONG_OUTPUT_THRESHOLD || undefined });
      }
    } else if (bt === "tool_use") {
      toolIdx += 1;
      const name = asString(block.name) ?? "unknown_tool";
      if (typeof block.id === "string") idToTool.set(block.id, name);
      list.push({
        kind: "tool",
        title: name,
        tool: name,
        argsSummary: summarizeArgs(block.input),
        status: "info",
        ts,
        parallelIndex: toolUses.length > 1 ? toolIdx : undefined,
        parallelSize: toolUses.length > 1 ? toolUses.length : undefined,
      });
    } else if (bt === "tool_result") {
      const { status, text } = resultOf(block);
      const name = typeof block.tool_use_id === "string" ? idToTool.get(block.tool_use_id) : undefined;
      const attached = list.attachResult(name, status, text || undefined);
      if (!attached) {
        warnings.push(`line: tool_result without matching tool_use (${name ?? block.tool_use_id ?? "?"})`);
        list.push({ kind: "tool", title: name ?? "orphan_result", tool: name, resultDetail: text || undefined, status });
      }
    } else if (bt === "thinking" || bt === "image" || bt === "document") {
      // deliberately not rendered: internal reasoning & attachments keep the board readable
    } else {
      list.push({ kind: "unknown", title: `block:${bt || "?"}`, detail: condense(JSON.stringify(block), 100), status: "info", ts });
    }
  }
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
    format: "claude",
  };
}
