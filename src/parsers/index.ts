import type { FormatName, ParseResult } from "../types";
import { SUPPORTED_FORMATS } from "../types";
import { parseClaude } from "./claude";
import { parseCodex } from "./codex";
import { parseGeneric } from "./generic";

export { parseClaude } from "./claude";
export { parseCodex } from "./codex";
export { parseGeneric } from "./generic";

/**
 * Format auto-detection: sniff the first non-empty lines.
 *  - Claude:   {"type":"user"|"assistant","message":{...},"timestamp":...}
 *  - Codex:    {"timestamp":...,"type":"session_meta"|"response_item",...}
 *  - Generic:  JSON with role/content keys, or anything parseable
 *  - Fallback: generic parser flags unparseable lines as warnings
 */
export function detectFormat(raw: string): Exclude<FormatName, "auto"> {
  const lines = raw.split("\n").filter((l) => l.trim().length > 0).slice(0, 20);
  let scoreClaude = 0;
  let scoreCodex = 0;
  let scoreGeneric = 0;
  for (const line of lines) {
    try {
      const obj: unknown = JSON.parse(line);
      if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
        const o = obj as Record<string, unknown>;
        if (o.type === "user" || o.type === "assistant") scoreClaude += 2;
        if (o.type === "summary" || o.type === "system" || o.type === "result") scoreClaude += 1;
        if (o.type === "session_meta" || o.type === "response_item" || o.type === "event_msg") scoreCodex += 3;
        if (typeof o.role === "string") scoreGeneric += 2;
        if (typeof o.tool === "string" || typeof o.tool_name === "string") scoreGeneric += 1;
      }
    } catch {
      // unparseable line: no signal
    }
  }
  if (scoreCodex > scoreClaude && scoreCodex > scoreGeneric) return "codex";
  if (scoreClaude > scoreGeneric) return "claude";
  return "generic";
}

export function parseTranscript(raw: string, format: FormatName = "auto"): ParseResult {
  if (raw.trim().length === 0) {
    return {
      storyboard: {
        title: "Empty transcript",
        steps: [],
        stats: {
          totalSteps: 0, userMessages: 0, assistantTexts: 0, toolCalls: 0,
          errors: 0, retries: 0, loopSuspects: 0, parallelGroups: 0,
          durationMs: null, tokens: null,
          format: format === "auto" ? "auto" : format,
        },
        annotations: [],
      },
      warnings: ["transcript is empty"],
    };
  }
  const chosen: Exclude<FormatName, "auto"> = format === "auto" ? detectFormat(raw) : format;
  if (!SUPPORTED_FORMATS.includes(chosen)) {
    // unreachable via types; defensive for JS callers
    return parseGeneric(raw);
  }
  switch (chosen) {
    case "claude":
      return parseClaude(raw);
    case "codex":
      return parseCodex(raw);
    default:
      return parseGeneric(raw);
  }
}
