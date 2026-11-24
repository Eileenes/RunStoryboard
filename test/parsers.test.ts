import { describe, expect, it } from "vitest";
import { detectFormat, parseTranscript } from "../src/parsers";
import { storyboardFromTranscript } from "../src";

const claudeLine = (obj: Record<string, unknown>): string => JSON.stringify(obj);

const SAMPLE_CLAUDE = [
  claudeLine({ type: "user", timestamp: "2026-11-24T09:00:00.000Z", message: { role: "user", content: "fix the bug" } }),
  claudeLine({ type: "assistant", timestamp: "2026-11-24T09:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "on it" }] } }),
  claudeLine({ type: "assistant", timestamp: "2026-11-24T09:00:03.000Z", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a.ts" } }] } }),
  claudeLine({ type: "user", timestamp: "2026-11-24T09:00:04.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "file body" }] } }),
  claudeLine({ type: "assistant", timestamp: "2026-11-24T09:00:09.000Z", message: { role: "assistant", content: [{ type: "text", text: "done" }] } }),
].join("\n");

describe("detectFormat", () => {
  it("detects claude sessions", () => {
    expect(detectFormat(SAMPLE_CLAUDE)).toBe("claude");
  });

  it("detects codex sessions", () => {
    const raw = [
      JSON.stringify({ timestamp: "t", type: "session_meta", payload: { id: "x" } }),
      JSON.stringify({ timestamp: "t", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] } }),
    ].join("\n");
    expect(detectFormat(raw)).toBe("codex");
  });

  it("falls back to generic for role/content JSONL", () => {
    const raw = '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi"}';
    expect(detectFormat(raw)).toBe("generic");
  });

  it("falls back to generic for garbage", () => {
    expect(detectFormat("not json at all\nstill not json")).toBe("generic");
  });
});

describe("claude parser", () => {
  it("parses messages, tool calls and merges results", () => {
    const { storyboard, warnings } = parseTranscript(SAMPLE_CLAUDE, "claude");
    expect(warnings).toHaveLength(0);
    expect(storyboard.steps).toHaveLength(4); // user, assistant, tool(merged), assistant
    const [u, a, tool, done] = storyboard.steps;
    expect(u?.kind).toBe("user");
    expect(u?.detail).toBe("fix the bug");
    expect(a?.kind).toBe("assistant_text");
    expect(tool?.kind).toBe("tool");
    expect(tool?.tool).toBe("Read");
    expect(tool?.resultDetail).toBe("file body");
    expect(tool?.status).toBe("ok");
    expect(done?.detail).toBe("done");
    // title comes from first user message
    expect(storyboard.title).toBe("fix the bug");
  });

  it("marks error results on the tool card", () => {
    const raw = [
      claudeLine({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t9", name: "Bash", input: { command: "npm test" } }] } }),
      claudeLine({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t9", content: "FAIL", is_error: true }] } }),
    ].join("\n");
    const { storyboard } = parseTranscript(raw, "claude");
    expect(storyboard.steps).toHaveLength(1);
    expect(storyboard.steps[0]?.status).toBe("error");
    expect(storyboard.steps[0]?.resultDetail).toBe("FAIL");
  });

  it("reports orphan tool results as warnings and cards", () => {
    const raw = claudeLine({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "ghost", content: "x" }] } });
    const { storyboard, warnings } = parseTranscript(raw, "claude");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(storyboard.steps[0]?.title).toBe("orphan_result");
  });

  it("labels parallel tool calls", () => {
    const raw = claudeLine({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "p1", name: "Read", input: { file_path: "/a" } },
          { type: "tool_use", id: "p2", name: "Grep", input: { pattern: "x" } },
          { type: "tool_use", id: "p3", name: "Bash", input: { command: "ls" } },
        ],
      },
    });
    const { storyboard } = parseTranscript(raw, "claude");
    const tools = storyboard.steps.filter((s) => s.kind === "tool");
    expect(tools).toHaveLength(3);
    expect(tools.every((t) => t.parallelSize === 3)).toBe(true);
    expect(tools.map((t) => t.parallelIndex)).toEqual([1, 2, 3]);
  });

  it("skips thinking blocks and empty text", () => {
    const raw = claudeLine({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "thinking", text: "internal" }, { type: "text", text: "  " }, { type: "text", text: "visible" }] },
    });
    const { storyboard } = parseTranscript(raw, "claude");
    expect(storyboard.steps).toHaveLength(1);
    expect(storyboard.steps[0]?.detail).toBe("visible");
  });

  it("warns on unknown types and non-JSON lines instead of crashing", () => {
    const raw = 'not json\n' + claudeLine({ type: "mystery", data: 1 }) + "\n" + SAMPLE_CLAUDE;
    const { storyboard, warnings } = parseTranscript(raw, "claude");
    expect(storyboard.steps.length).toBeGreaterThanOrEqual(4);
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("flags long assistant output pre-truncation", () => {
    const long = "x".repeat(900);
    const raw = claudeLine({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: long }] } });
    const { storyboard } = parseTranscript(raw, "claude");
    expect(storyboard.steps[0]?.longOutput).toBe(true);
  });
});

describe("codex parser", () => {
  it("parses messages, function calls and outputs", () => {
    const raw = [
      JSON.stringify({ timestamp: "2026-11-24T08:00:00.000Z", type: "session_meta", payload: { id: "rs_1" } }),
      JSON.stringify({ timestamp: "2026-11-24T08:00:01.000Z", type: "event_msg", payload: { type: "token_count" } }),
      JSON.stringify({ timestamp: "2026-11-24T08:00:02.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "why 500s?" }] } }),
      JSON.stringify({ timestamp: "2026-11-24T08:00:05.000Z", type: "response_item", payload: { type: "function_call", name: "shell", arguments: '{"command":["git","log"]}', call_id: "c1" } }),
      JSON.stringify({ timestamp: "2026-11-24T08:00:06.000Z", type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "abc fix" } }),
      JSON.stringify({ timestamp: "2026-11-24T08:00:10.000Z", type: "response_item", payload: { type: "function_call", name: "shell", arguments: '{"command":["git","show"]}', call_id: "c2" } }),
      JSON.stringify({ timestamp: "2026-11-24T08:00:11.000Z", type: "response_item", payload: { type: "function_call_output", call_id: "c2", output: { type: "function_call_error", message: "boom" } } }),
      JSON.stringify({ timestamp: "2026-11-24T08:00:15.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "root cause found" }] } }),
    ].join("\n");
    const { storyboard, warnings } = parseTranscript(raw, "codex");
    expect(warnings).toHaveLength(0);
    // session system card + user + tool + tool(error merged) + assistant
    expect(storyboard.steps.map((s) => s.kind)).toEqual(["system", "user", "tool", "tool", "assistant_text"]);
    const tool1 = storyboard.steps[2];
    expect(tool1?.resultDetail).toBe("abc fix");
    const tool2 = storyboard.steps[3];
    expect(tool2?.status).toBe("error");
    expect(storyboard.title).toBe("why 500s?");
  });

  it("tolerates unknown payload types with warnings", () => {
    const raw = JSON.stringify({ timestamp: "t", type: "response_item", payload: { type: "web_search_call", url: "x" } });
    const { storyboard, warnings } = parseTranscript(raw, "codex");
    expect(storyboard.steps).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });

  it("skips system/developer role messages", () => {
    const raw = [
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "system", content: [{ type: "input_text", text: "You are helpful" }] } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] } }),
    ].join("\n");
    const { storyboard } = parseTranscript(raw, "codex");
    expect(storyboard.steps).toHaveLength(1);
    expect(storyboard.steps[0]?.kind).toBe("user");
  });
});

describe("generic parser", () => {
  it("parses role/content pairs", () => {
    const raw = '{"role":"user","content":"do the thing"}\n{"role":"assistant","content":"ok"}';
    const { storyboard } = parseTranscript(raw, "generic");
    expect(storyboard.steps.map((s) => s.kind)).toEqual(["user", "assistant_text"]);
  });

  it("parses tool calls and results", () => {
    const raw = [
      '{"tool":"Search","arguments":{"q":"ts parsers"}}',
      '{"result":"3 hits"}',
      '{"tool":"Fetch","input":{"url":"https://x.dev"},"is_error":true,"error":"timeout"}',
    ].join("\n");
    const { storyboard } = parseTranscript(raw, "generic");
    expect(storyboard.steps).toHaveLength(2);
    const call = storyboard.steps[0];
    expect(call?.kind).toBe("tool");
    expect(call?.tool).toBe("Search");
    expect(call?.resultDetail).toBe("3 hits");
    const call2 = storyboard.steps[1];
    expect(call2?.status).toBe("error");
  });

  it("falls back to system cards for unknown JSON", () => {
    const raw = '{"event":"checkpoint","ts":100}';
    const { storyboard } = parseTranscript(raw, "generic");
    expect(storyboard.steps[0]?.kind).toBe("system");
    expect(storyboard.steps[0]?.title).toBe("checkpoint");
  });

  it("auto mode routes role-based JSONL through generic", () => {
    const raw = '{"role":"user","content":"auto detect me"}';
    const { storyboard } = parseTranscript(raw, "auto");
    expect(storyboard.steps[0]?.kind).toBe("user");
  });
});

describe("empty and degenerate input", () => {
  it("handles empty transcript", () => {
    const { storyboard, warnings } = storyboardFromTranscript("", "auto");
    expect(storyboard.steps).toHaveLength(0);
    expect(storyboard.stats.totalSteps).toBe(0);
    expect(warnings).toContain("transcript is empty");
  });

  it("handles whitespace-only transcript", () => {
    const { storyboard } = storyboardFromTranscript("  \n  \n", "auto");
    expect(storyboard.steps).toHaveLength(0);
  });
});
