import type { Annotation, RunStats, Step } from "../types";

/**
 * Deterministic run analysis. These are the "what happened" annotations that
 * make the storyboard more than a pretty list:
 *
 *  - retry chains : the same tool called again right after a failed attempt
 *  - loop suspects: the same tool invoked >=3 times with identical arguments
 *  - parallel     : one assistant turn emitting several tool calls at once
 *  - long output  : an assistant text block over the readability threshold
 *
 * Everything here is pure set/sequence logic over parsed steps — no heuristics
 * on prose, no LLM in the loop, same input always yields the same annotations.
 */

export function analyze(steps: Step[]): { annotations: Annotation[]; stats: Omit<RunStats, "format"> } {
  const annotations: Annotation[] = [];

  // ---- retry chains -------------------------------------------------------
  let retries = 0;
  let i = 0;
  while (i < steps.length) {
    const s = steps[i] as Step;
    if (s.kind === "tool" && s.status === "error") {
      let j = i + 1;
      while (j < steps.length) {
        const n = steps[j] as Step;
        if (n.kind === "tool" && n.tool === s.tool) break;
        if (n.kind === "user") break; // a new user turn resets the chain
        j++;
      }
      const next = steps[j] as Step | undefined;
      if (next !== undefined && next.kind === "tool" && next.tool === s.tool) {
        // collect the whole chain of consecutive failed calls to this tool
        const seqs: number[] = [s.seq];
        let k = j;
        while (k < steps.length) {
          const n = steps[k] as Step;
          if (n.kind === "tool" && n.tool === s.tool && n.status === "error") {
            seqs.push(n.seq);
            k++;
            continue;
          }
          if (n.kind === "tool" && n.tool === s.tool) {
            seqs.push(n.seq); // final success
            k++;
          }
          break;
        }
        retries += seqs.length - 1;
        annotations.push({
          type: "retry",
          seqs,
          tool: s.tool,
          note: `${s.tool} failed ${seqs.length - 1}× before ${seqs.length === 2 ? "succeeding" : "the last attempt"}`,
        });
        i = k;
        continue;
      }
    }
    i++;
  }

  // ---- loop suspects ------------------------------------------------------
  let loopSuspects = 0;
  const calls = new Map<string, number[]>();
  for (const s of steps) {
    if (s.kind !== "tool" || s.tool === undefined) continue;
    const key = `${s.tool}::${(s.argsSummary ?? "").slice(0, 120)}`;
    const arr = calls.get(key) ?? [];
    arr.push(s.seq);
    calls.set(key, arr);
  }
  for (const [key, seqs] of calls) {
    if (seqs.length >= 3) {
      loopSuspects += 1;
      const tool = key.split("::")[0] ?? "?";
      annotations.push({
        type: "loop",
        seqs: [...seqs],
        tool,
        note: `${tool} called ${seqs.length}× with identical arguments — likely a loop`,
      });
    }
  }

  // ---- parallel groups ----------------------------------------------------
  let parallelGroups = 0;
  const groups = new Map<string, Step[]>();
  for (const s of steps) {
    if (s.parallelSize !== undefined && s.parallelSize > 1) {
      const key = `${s.ts ?? "nots"}-${s.parallelSize}-${s.seq - (s.parallelIndex ?? 1)}`;
      const arr = groups.get(key) ?? [];
      arr.push(s);
      groups.set(key, arr);
    }
  }
  for (const members of groups.values()) {
    parallelGroups += 1;
    annotations.push({
      type: "parallel",
      seqs: members.map((m) => m.seq),
      note: `${members.length} tools invoked in parallel`,
    });
  }

  // ---- long outputs -------------------------------------------------------
  for (const s of steps) {
    if (s.longOutput === true) {
      annotations.push({
        type: "long_output",
        seqs: [s.seq],
        note: "long assistant message (truncated on the board)",
      });
    }
  }

  // ---- stats --------------------------------------------------------------
  let userMessages = 0;
  let assistantTexts = 0;
  let toolCalls = 0;
  let errors = 0;
  for (const s of steps) {
    if (s.kind === "user") userMessages++;
    else if (s.kind === "assistant_text") assistantTexts++;
    else if (s.kind === "tool") {
      toolCalls++;
      if (s.status === "error") errors++;
    }
  }

  const tss = steps.map((s) => s.ts).filter((t): t is number => typeof t === "number");
  const durationMs = tss.length >= 2 ? Math.max(...tss) - Math.min(...tss) : null;
  const tokens = steps.reduce((acc, s) => acc + (s.tokens ?? 0), 0);

  return {
    annotations,
    stats: {
      totalSteps: steps.length,
      userMessages,
      assistantTexts,
      toolCalls,
      errors,
      retries,
      loopSuspects,
      parallelGroups,
      durationMs,
      tokens: tokens > 0 ? tokens : null,
    },
  };
}
