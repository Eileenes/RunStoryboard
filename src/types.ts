/**
 * RunStoryboard — core data model.
 *
 * A transcript is parsed into an ordered list of Steps. Every Step is one
 * visible beat of the run: a user message, an assistant text block, a tool
 * invocation (with its result attached), or a system marker.
 */

export type StepKind = "user" | "assistant_text" | "tool" | "system" | "unknown";

export type StepStatus = "ok" | "error" | "info";

export interface Step {
  /** 1-based order in the run. */
  seq: number;
  kind: StepKind;
  /** Short headline shown on the storyboard card. */
  title: string;
  /** Truncated body text (assistant prose, user prompt, tool output). */
  detail?: string;
  /** Tool name for kind === "tool". */
  tool?: string;
  /** Compact argument summary for tool calls. */
  argsSummary?: string;
  /** Truncated tail of the tool result (what came back). */
  resultDetail?: string;
  /** True when the original (pre-truncation) text exceeded LONG_OUTPUT_THRESHOLD. */
  longOutput?: boolean;
  status: StepStatus;
  /** Epoch milliseconds when available. */
  ts?: number;
  /** 1-based index within a parallel group (assistant emitted several tool calls at once). */
  parallelIndex?: number;
  /** Size of the parallel group this step belongs to. */
  parallelSize?: number;
  /** Reported token usage when available. */
  tokens?: number;
}

export interface RunStats {
  totalSteps: number;
  userMessages: number;
  assistantTexts: number;
  toolCalls: number;
  errors: number;
  retries: number;
  loopSuspects: number;
  parallelGroups: number;
  durationMs: number | null;
  tokens: number | null;
  format: string;
}

export type AnnotationType = "retry" | "loop" | "parallel" | "long_output";

export interface Annotation {
  type: AnnotationType;
  /** Steps covered by this annotation. */
  seqs: number[];
  tool?: string;
  note: string;
}

export interface Storyboard {
  title: string;
  steps: Step[];
  stats: RunStats;
  annotations: Annotation[];
}

export interface ParseResult {
  storyboard: Storyboard;
  /** Non-fatal observations (skipped lines, unknown shapes...). */
  warnings: string[];
}

export const SUPPORTED_FORMATS = ["auto", "claude", "codex", "generic"] as const;
export type FormatName = (typeof SUPPORTED_FORMATS)[number];

/** Maximum characters kept in a card's detail text. */
export const DETAIL_LIMIT = 220;

/** Assistant text longer than this is flagged as long_output. */
export const LONG_OUTPUT_THRESHOLD = 800;
