import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { renderTranscript } from "./index";
import { SUPPORTED_FORMATS, type FormatName } from "./types";

/**
 * Built-in preview server. Serves the console plus one JSON API:
 *   GET  /health
 *   GET  /                    -> console.html
 *   GET  /static/<file>       -> static assets
 *   POST /api/render          -> { html, svg, stats, warnings }
 *   GET  /api/demo?name=x     -> bundled example transcript
 * Everything else: 404. Wrong method on a known route: 405.
 */

const STATIC_DIR = path.join(__dirname, "..", "static");
const EXAMPLES_DIR = path.join(__dirname, "..", "examples");

const DEMOS: Record<string, { file: string; format: FormatName }> = {
  clean: { file: "clean-session.jsonl", format: "claude" },
  chaotic: { file: "chaotic-session.jsonl", format: "claude" },
  codex: { file: "codex-session.jsonl", format: "codex" },
};

const MAX_BODY = 8 * 1024 * 1024; // 8 MB — transcripts can get long

export function createServer(port: number): http.Server {
  return http.createServer((req, res) => {
    void handle(req, res, port);
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, port: number): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const route = url.pathname;

  try {
    if (route === "/health") {
      if (req.method !== "GET" && req.method !== "HEAD") return method405(res, "GET");
      return json(res, 200, { status: "ok", service: "runstoryboard", version: VERSION });
    }

    if (route === "/" || route === "/index.html") {
      if (req.method !== "GET") return method405(res, "GET");
      return serveFile(res, path.join(STATIC_DIR, "console.html"));
    }

    if (route.startsWith("/static/")) {
      if (req.method !== "GET") return method405(res, "GET");
      const raw = route.slice("/static/".length);
      let rel: string;
      try {
        rel = decodeURIComponent(raw);
      } catch {
        return json(res, 400, { error: "bad encoding" });
      }
      const resolved = path.resolve(STATIC_DIR, rel);
      if (!resolved.startsWith(STATIC_DIR + path.sep)) {
        return json(res, 403, { error: "forbidden" });
      }
      return serveFile(res, resolved);
    }

    if (route === "/api/render") {
      if (req.method !== "POST") return method405(res, "POST");
      const body = await readBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "body must be JSON: { content, format? }" });
      }
      const obj = parsed as Record<string, unknown> | null;
      if (obj === null || typeof obj !== "object" || typeof obj.content !== "string") {
        return json(res, 400, { error: "missing string field: content" });
      }
      const fmt = typeof obj.format === "string" && (SUPPORTED_FORMATS as readonly string[]).includes(obj.format)
        ? (obj.format as FormatName)
        : "auto";
      const { storyboard, svg, html, warnings } = renderTranscript(obj.content, fmt);
      return json(res, 200, { html, svg, stats: storyboard.stats, annotations: storyboard.annotations, warnings });
    }

    if (route === "/api/demo") {
      if (req.method !== "GET") return method405(res, "GET");
      const name = url.searchParams.get("name") ?? "chaotic";
      const demo = DEMOS[name];
      if (demo === undefined) {
        return json(res, 404, { error: `unknown demo "${name}", expected one of: ${Object.keys(DEMOS).join(", ")}` });
      }
      const content = fs.readFileSync(path.join(EXAMPLES_DIR, demo.file), "utf8");
      return json(res, 200, { content, format: demo.format });
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : "internal error" });
  }
}

export const VERSION = "1.0.0";

function json(res: http.ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function method405(res: http.ServerResponse, allowed: string): void {
  json(res, 405, { error: `method not allowed, use ${allowed}` });
}

function serveFile(res: http.ServerResponse, file: string): void {
  fs.readFile(file, (err, data) => {
    if (err) {
      json(res, 404, { error: "not found" });
      return;
    }
    const type =
      file.endsWith(".html") ? "text/html; charset=utf-8"
      : file.endsWith(".js") ? "text/javascript; charset=utf-8"
      : file.endsWith(".css") ? "text/css; charset=utf-8"
      : file.endsWith(".json") ? "application/json; charset=utf-8"
      : file.endsWith(".svg") ? "image/svg+xml"
      : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Content-Length": data.length });
    res.end(data);
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large (max 8 MB)"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
