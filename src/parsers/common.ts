import type { Step, StepStatus } from "../types";
import { DETAIL_LIMIT } from "../types";

/**
 * Shared low-level helpers used by every transcript parser.
 */

/** Safe JSON.parse that never throws. */
export function tryParse(line: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(line);
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Truncate long text and collapse whitespace so cards stay readable. */
export function condense(text: string, limit: number = DETAIL_LIMIT): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  return flat.slice(0, limit - 1) + "…";
}

export function truncateOneLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  return flat.slice(0, limit - 1) + "…";
}

/** Compact summary of tool arguments: first scalar fields, capped. */
export function summarizeArgs(args: unknown): string | undefined {
  if (args === null || args === undefined) return undefined;
  if (typeof args === "string") {
    const s = args.trim();
    return s.length > 0 ? condense(s, 90) : undefined;
  }
  if (typeof args === "object") {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
      let rendered: string;
      if (typeof v === "string") rendered = `"${condense(v, 40)}"`;
      else if (typeof v === "number" || typeof v === "boolean") rendered = String(v);
      else if (v === null || v === undefined) rendered = "null";
      else rendered = condense(JSON.stringify(v), 40);
      parts.push(`${k}=${rendered}`);
      if (parts.length >= 3) break;
    }
    return parts.length > 0 ? condense(parts.join(", "), 120) : undefined;
  }
  return condense(String(args), 90);
}

/** Pull a number out of an unknown value when it really is a number. */
export function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export interface ParsedLine {
  steps: Omit<Step, "seq">[];
  warning?: string;
}

/** A builder that owns seq numbering while the parser walks the file. */
export class StepList {
  readonly steps: Step[] = [];

  push(step: Omit<Step, "seq">): Step {
    const full: Step = { ...step, seq: this.steps.length + 1 };
    this.steps.push(full);
    return full;
  }

  /**
   * Attach a result to the most recent un-paired tool call. In Claude format
   * results ride inside the *next* user message, so the scan must cross user
   * steps; the un-paired guard prevents double attachment.
   */
  attachResult(toolName: string | undefined, status: StepStatus, detail: string | undefined): boolean {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      const s = this.steps[i];
      if (s && s.kind === "tool" && s.status === "info" && s.resultDetail === undefined) {
        if (toolName === undefined || s.tool === toolName) {
          s.status = status;
          if (detail !== undefined) s.resultDetail = detail;
          return true;
        }
      }
    }
    return false;
  }

  finish(): Step[] {
    return this.steps;
  }
}
