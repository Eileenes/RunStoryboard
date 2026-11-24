import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const CLI = path.join(__dirname, "..", "dist", "cli.js");
const EXAMPLES = path.join(__dirname, "..", "examples");

function run(args: string[], cwd?: string): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
  }
}

function tmpFile(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rsb-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, "utf8");
  return file;
}

describe("CLI basics", () => {
  it("prints help and exits 0", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage:");
    expect(r.stdout).toContain("render");
  });

  it("prints version", () => {
    const r = run(["--version"]);
    expect(r.stdout.trim()).toBe("1.0.0");
  });

  it("bare invocation shows usage", () => {
    const r = run([]);
    expect(r.stdout).toContain("Usage:");
  });
});

describe("CLI render", () => {
  it("writes an HTML board next to the input", () => {
    const input = tmpFile("session.jsonl", fs.readFileSync(path.join(EXAMPLES, "clean-session.jsonl"), "utf8"));
    const r = run(["render", input]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("board written");
    const out = input.replace(/\.jsonl$/, ".storyboard.html");
    expect(fs.existsSync(out)).toBe(true);
    const html = fs.readFileSync(out, "utf8");
    expect(html).toContain("<svg");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("honors --out", () => {
    const input = tmpFile("s2.jsonl", '{"role":"user","content":"hi"}\n');
    const dir = path.dirname(input);
    const out = path.join(dir, "custom.html");
    const r = run(["render", input, "--out", out]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
  });

  it("honors --out=VALUE form and flag-before-positional order", () => {
    const input = tmpFile("s3.jsonl", '{"role":"user","content":"hi"}\n');
    const dir = path.dirname(input);
    const out = path.join(dir, "eq-form.html");
    const r = run(["render", "--out=" + out, input]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
  });

  it("prints JSON stats with --json", () => {
    const input = tmpFile("s4.jsonl", fs.readFileSync(path.join(EXAMPLES, "chaotic-session.jsonl"), "utf8"));
    const r = run(["render", input, "--json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.stats.toolCalls).toBeGreaterThan(0);
    expect(Array.isArray(parsed.annotations)).toBe(true);
  });

  it("writes raw SVG with --svg", () => {
    const input = tmpFile("s5.jsonl", '{"role":"user","content":"hi"}\n');
    const out = path.join(path.dirname(input), "board.svg");
    const r = run(["render", input, "--svg", "--out", out]);
    expect(r.status).toBe(0);
    const svg = fs.readFileSync(out, "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
  });

  it("errors with exit 2 on missing file", () => {
    const r = run(["render", "/definitely/not/here.jsonl"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("cannot read");
  });

  it("errors with exit 2 on missing path argument", () => {
    const r = run(["render"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("needs a transcript file");
  });

  it("rejects unknown --format", () => {
    const input = tmpFile("s6.jsonl", '{"role":"user","content":"hi"}\n');
    const r = run(["render", input, "--format", "yaml"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown format");
  });
});

describe("CLI demo", () => {
  it("writes the demo board to a chosen path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rsb-demo-"));
    const out = path.join(dir, "demo.html");
    const r = run(["demo", "--out", out]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.readFileSync(out, "utf8")).toContain("<svg");
  });
});

describe("CLI serve (smoke)", () => {
  it("rejects an invalid port", () => {
    const r = run(["serve", "--port", "notaport"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("invalid port");
  });
});
