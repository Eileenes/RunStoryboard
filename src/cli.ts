#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { storyboardFromTranscript, renderFull } from "./index";
import { createServer, VERSION } from "./server";
import { SUPPORTED_FORMATS, type FormatName } from "./types";

/**
 * CLI — hand-rolled argument parsing (positional args and flags may appear in
 * any order; `--flag value` and `--flag=value` both accepted).
 *
 *   runstoryboard render <transcript.jsonl> [--format auto|claude|codex|generic]
 *                        [--out board.html] [--json] [--svg]
 *   runstoryboard demo   [--out storyboard-demo.html]
 *   runstoryboard serve  [--port 7420]
 *   runstoryboard --help | --version
 */

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  let i = 0;
  let command = "";
  while (i < argv.length) {
    const a = argv[i] as string;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        flags.set(a.slice(2, eq), a.slice(eq + 1));
        i++;
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      const looksLikeValue =
        next !== undefined && !next.startsWith("--") && ["format", "out", "port", "name"].includes(key);
      if (looksLikeValue) {
        flags.set(key, next as string);
        i += 2;
        continue;
      }
      flags.set(key, true);
      i++;
      continue;
    }
    if (command === "") command = a;
    else positional.push(a);
    i++;
  }
  return { command, positional, flags };
}

function flag(args: ParsedArgs, key: string): string | undefined {
  const v = args.flags.get(key);
  return typeof v === "string" ? v : undefined;
}

function usage(): string {
  return `runstoryboard ${VERSION} — turn agent session transcripts into deterministic storyboard diagrams

Usage:
  runstoryboard render <transcript.jsonl> [--format auto|claude|codex|generic]
                          [--out board.html] [--json] [--svg]
  runstoryboard demo [--out storyboard-demo.html]
  runstoryboard serve [--port 7420]

Commands:
  render   Parse a transcript file and write a self-contained HTML board
  demo     Render the bundled chaotic example (great first look)
  serve    Start the preview server with paste/upload console

Options:
  --format  Force a parser (default: auto-detect)
  --out     Output path (default: <input>.storyboard.html)
  --json    Print machine-readable stats instead of writing the board
  --svg     Write raw SVG instead of HTML
  --port    Server port (default: 7420)
  --help    Show this help
  --version Show version`;
}

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(2);
}

function main(): void {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.flags.get("help") === true || args.command === "help") {
    console.log(usage());
    return;
  }
  if (args.flags.get("version") === true) {
    console.log(VERSION);
    return;
  }

  switch (args.command) {
    case "render":
      return cmdRender(args);
    case "demo":
      return cmdDemo(args);
    case "serve":
      return cmdServe(args);
    default:
      console.log(usage());
      process.exit(args.command === "" ? 0 : 2);
  }
}

function readFormat(args: ParsedArgs): FormatName {
  const f = flag(args, "format") ?? "auto";
  if (!(SUPPORTED_FORMATS as readonly string[]).includes(f)) {
    return fail(`unknown format "${f}", expected one of: ${SUPPORTED_FORMATS.join(", ")}`);
  }
  return f as FormatName;
}

function cmdRender(args: ParsedArgs): void {
  const input = args.positional[0];
  if (input === undefined) fail("render needs a transcript file path");
  let raw: string;
  try {
    raw = fs.readFileSync(input, "utf8");
  } catch (err) {
    fail(`cannot read ${input}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const { storyboard, warnings } = storyboardFromTranscript(raw, readFormat(args));

  if (args.flags.get("json") === true) {
    console.log(JSON.stringify({ stats: storyboard.stats, annotations: storyboard.annotations, warnings }, null, 2));
    return;
  }

  const out =
    flag(args, "out") ??
    (input.endsWith(".storyboard.html") ? input : `${input.replace(/\.jsonl$/, "")}.storyboard.html`);
  const { svg, html } = renderFull(storyboard);
  const payload = args.flags.get("svg") === true ? svg : html;
  fs.writeFileSync(out, payload, "utf8");
  const stats = storyboard.stats;
  console.log(
    `board written: ${out} (${stats.totalSteps} steps, ${stats.toolCalls} tool calls, ${stats.errors} errors, ${storyboard.annotations.length} findings)`,
  );
  for (const w of warnings.slice(0, 5)) console.error(`warn: ${w}`);
  if (warnings.length > 5) console.error(`warn: ... and ${warnings.length - 5} more`);
}

function cmdDemo(args: ParsedArgs): void {
  const examplesDir = path.join(__dirname, "..", "examples");
  const raw = fs.readFileSync(path.join(examplesDir, "chaotic-session.jsonl"), "utf8");
  const { storyboard } = storyboardFromTranscript(raw, "claude");
  const { html } = renderFull(storyboard);
  const out = flag(args, "out") ?? "storyboard-demo.html";
  fs.writeFileSync(out, html, "utf8");
  console.log(`demo board written: ${out} — open it in a browser`);
}

function cmdServe(args: ParsedArgs): void {
  const portRaw = flag(args, "port") ?? "7420";
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) fail(`invalid port "${portRaw}"`);
  const server = createServer(port);
  server.listen(port, () => {
    console.log(`runstoryboard serving on http://localhost:${port}`);
    console.log(`  console  http://localhost:${port}/`);
    console.log(`  health   http://localhost:${port}/health`);
  });
}

main();
