import { describe, expect, it } from "vitest";
import { analyze } from "../src/analyze";
import { storyboardFromTranscript } from "../src";
import type { Step } from "../src/types";

function toolStep(seq: number, tool: string, status: Step["status"], args?: string): Step {
  return { seq, kind: "tool", title: tool, tool, argsSummary: args, status };
}

describe("retry chains", () => {
  it("detects fail -> retry -> success on the same tool", () => {
    const steps: Step[] = [
      { seq: 1, kind: "user", title: "user", status: "info" },
      toolStep(2, "Bash", "error"),
      toolStep(3, "Bash", "ok"),
    ];
    const { annotations, stats } = analyze(steps);
    const retry = annotations.find((a) => a.type === "retry");
    expect(retry).toBeDefined();
    expect(retry?.seqs).toEqual([2, 3]);
    expect(retry?.tool).toBe("Bash");
    expect(stats.retries).toBe(1);
  });

  it("counts multi-failure chains", () => {
    const steps: Step[] = [
      toolStep(1, "shell", "error"),
      toolStep(2, "shell", "error"),
      toolStep(3, "shell", "error"),
      toolStep(4, "shell", "ok"),
    ];
    const { annotations, stats } = analyze(steps);
    const retry = annotations.find((a) => a.type === "retry");
    expect(retry?.seqs).toEqual([1, 2, 3, 4]);
    expect(stats.retries).toBe(3);
  });

  it("flags retries even when other tools ran in between", () => {
    const steps: Step[] = [
      toolStep(1, "Bash", "error"),
      toolStep(2, "Read", "ok"),
      toolStep(3, "Bash", "ok"),
    ];
    const { annotations, stats } = analyze(steps);
    const retry = annotations.find((a) => a.type === "retry");
    expect(retry).toBeDefined();
    expect(retry?.seqs).toEqual([1, 3]);
    expect(stats.retries).toBe(1);
  });

  it("stops chains at a new user turn", () => {
    const steps: Step[] = [
      toolStep(1, "Bash", "error"),
      { seq: 2, kind: "user", title: "user", status: "info" },
      toolStep(3, "Bash", "ok"),
    ];
    const { annotations } = analyze(steps);
    expect(annotations.find((a) => a.type === "retry")).toBeUndefined();
  });

  it("does not flag consecutive successful calls", () => {
    const steps: Step[] = [toolStep(1, "Bash", "ok"), toolStep(2, "Bash", "ok")];
    const { annotations, stats } = analyze(steps);
    expect(annotations.find((a) => a.type === "retry")).toBeUndefined();
    expect(stats.retries).toBe(0);
  });
});

describe("loop suspects", () => {
  it("flags >=3 identical tool+args calls", () => {
    const steps: Step[] = [
      toolStep(1, "Bash", "ok", "command=\"npm test\""),
      toolStep(2, "Bash", "ok", "command=\"npm test\""),
      toolStep(3, "Bash", "ok", "command=\"npm test\""),
    ];
    const { annotations, stats } = analyze(steps);
    const loop = annotations.find((a) => a.type === "loop");
    expect(loop).toBeDefined();
    expect(loop?.seqs).toEqual([1, 2, 3]);
    expect(stats.loopSuspects).toBe(1);
  });

  it("does not flag two identical calls", () => {
    const steps: Step[] = [toolStep(1, "Bash", "ok", "x"), toolStep(2, "Bash", "ok", "x")];
    const { annotations, stats } = analyze(steps);
    expect(annotations.find((a) => a.type === "loop")).toBeUndefined();
    expect(stats.loopSuspects).toBe(0);
  });

  it("distinguishes different arguments", () => {
    const steps: Step[] = [
      toolStep(1, "Read", "ok", "file=\"/a\""),
      toolStep(2, "Read", "ok", "file=\"/b\""),
      toolStep(3, "Read", "ok", "file=\"/c\""),
    ];
    const { annotations } = analyze(steps);
    expect(annotations.find((a) => a.type === "loop")).toBeUndefined();
  });
});

describe("parallel groups", () => {
  it("collects parallel tool calls into one annotation", () => {
    const steps: Step[] = [
      { seq: 1, kind: "tool", title: "Read", tool: "Read", status: "info", parallelIndex: 1, parallelSize: 2 },
      { seq: 2, kind: "tool", title: "Grep", tool: "Grep", status: "info", parallelIndex: 2, parallelSize: 2 },
    ];
    const { annotations, stats } = analyze(steps);
    const par = annotations.find((a) => a.type === "parallel");
    expect(par).toBeDefined();
    expect(par?.seqs).toEqual([1, 2]);
    expect(stats.parallelGroups).toBe(1);
  });

  it("ignores single tool calls", () => {
    const steps: Step[] = [
      { seq: 1, kind: "tool", title: "Read", tool: "Read", status: "info" },
    ];
    const { annotations, stats } = analyze(steps);
    expect(annotations.find((a) => a.type === "parallel")).toBeUndefined();
    expect(stats.parallelGroups).toBe(0);
  });
});

describe("stats", () => {
  it("counts kinds, errors and duration", () => {
    const steps: Step[] = [
      { seq: 1, kind: "user", title: "u", status: "info", ts: 1000 },
      { seq: 2, kind: "assistant_text", title: "a", status: "info", ts: 2000 },
      toolStep(3, "Bash", "ok"),
      toolStep(4, "Edit", "error"),
      { seq: 5, kind: "assistant_text", title: "a2", status: "info", ts: 6500 },
    ];
    const { stats } = analyze(steps);
    expect(stats.totalSteps).toBe(5);
    expect(stats.userMessages).toBe(1);
    expect(stats.assistantTexts).toBe(2);
    expect(stats.toolCalls).toBe(2);
    expect(stats.errors).toBe(1);
    expect(stats.durationMs).toBe(5500);
    expect(stats.tokens).toBeNull();
  });

  it("sums token usage when present", () => {
    const steps: Step[] = [
      { seq: 1, kind: "assistant_text", title: "a", status: "info", tokens: 120 },
      { seq: 2, kind: "tool", title: "t", tool: "t", status: "info", tokens: 80 },
    ];
    const { stats } = analyze(steps);
    expect(stats.tokens).toBe(200);
  });

  it("durationMs is null for single or missing timestamps", () => {
    expect(analyze([{ seq: 1, kind: "user", title: "u", status: "info", ts: 5 }]).stats.durationMs).toBeNull();
    expect(analyze([{ seq: 1, kind: "user", title: "u", status: "info" }]).stats.durationMs).toBeNull();
  });
});

describe("long output", () => {
  it("flags steps marked longOutput by the parser", () => {
    const steps: Step[] = [{ seq: 1, kind: "assistant_text", title: "a", status: "info", longOutput: true }];
    const { annotations } = analyze(steps);
    expect(annotations.find((a) => a.type === "long_output")).toBeDefined();
  });
});

describe("end-to-end annotations on the bundled fixtures", () => {
  it("clean session has zero findings", () => {
    const { storyboard } = storyboardFromTranscriptFixture("clean-session.jsonl");
    expect(storyboard.annotations).toHaveLength(0);
    expect(storyboard.stats.errors).toBe(0);
    expect(storyboard.stats.toolCalls).toBe(3);
  });

  it("chaotic session surfaces loop suspect and parallel group", () => {
    const { storyboard } = storyboardFromTranscriptFixture("chaotic-session.jsonl");
    const types = new Set(storyboard.annotations.map((a) => a.type));
    expect(types.has("loop")).toBe(true); // npm test run 3× with same args
    expect(types.has("parallel")).toBe(true); // Read + Grep in one turn
    expect(storyboard.stats.errors).toBe(1);
  });

  it("codex session surfaces the retry chain", () => {
    const { storyboard } = storyboardFromTranscriptFixture("codex-session.jsonl");
    const retry = storyboard.annotations.find((a) => a.type === "retry");
    expect(retry).toBeDefined();
    expect(retry?.tool).toBe("shell");
    expect(retry?.seqs.length).toBe(3); // fail, fail, succeed
    expect(storyboard.stats.toolCalls).toBe(6);
    expect(storyboard.stats.retries).toBe(2);
  });
});

import * as fs from "node:fs";
import * as path from "node:path";
function storyboardFromTranscriptFixture(name: string) {
  const raw = fs.readFileSync(path.join(__dirname, "..", "examples", name), "utf8");
  return storyboardFromTranscript(raw, "auto");
}
