import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { createServer } from "../src/server";

const PORT = 17420;
let server: http.Server;
const base = `http://127.0.0.1:${PORT}`;

function get(p: string): Promise<{ status: number; body: string; type: string }> {
  return new Promise((resolve, reject) => {
    http.get(`${base}${p}`, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, type: String(res.headers["content-type"]) }));
    }).on("error", reject);
  });
}

function post(p: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${base}${p}`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

function rawRequest(method: string, p: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${p}`, { method }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0 });
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  server = createServer(PORT);
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("health", () => {
  it("returns ok with service metadata", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("ok");
    expect(body.service).toBe("runstoryboard");
  });
});

describe("static console", () => {
  it("serves the console at /", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.type).toContain("text/html");
    expect(res.body).toContain("RUNSTORYBOARD");
  });

  it("blocks path traversal", async () => {
    const res = await get("/static/..%2F..%2Fpackage.json");
    expect(res.status).toBe(403);
  });

  it("404s unknown static files", async () => {
    const res = await get("/static/nope.js");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/render", () => {
  it("renders a claude transcript into html + stats", async () => {
    const content = fs.readFileSync(path.join(__dirname, "..", "examples", "clean-session.jsonl"), "utf8");
    const res = await post("/api/render", JSON.stringify({ content, format: "auto" }));
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.html).toContain("<svg");
    expect(body.stats.toolCalls).toBe(3);
    expect(body.stats.format).toBe("claude");
  });

  it("returns 400 for missing content", async () => {
    const res = await post("/api/render", JSON.stringify({ format: "auto" }));
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toContain("content");
  });

  it("returns 400 for non-JSON body", async () => {
    const res = await post("/api/render", "this is not json");
    expect(res.status).toBe(400);
  });

  it("returns 405 for GET on /api/render", async () => {
    const res = await rawRequest("GET", "/api/render");
    expect(res.status).toBe(405);
  });

  it("renders chaotic transcript with findings", async () => {
    const content = fs.readFileSync(path.join(__dirname, "..", "examples", "chaotic-session.jsonl"), "utf8");
    const res = await post("/api/render", JSON.stringify({ content }));
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.annotations.length).toBeGreaterThanOrEqual(2);
  });
});

describe("GET /api/demo", () => {
  it("returns the chaotic demo by default", async () => {
    const res = await get("/api/demo");
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.format).toBe("claude");
    expect(body.content).toContain("tool_use");
  });

  it("serves each named demo", async () => {
    for (const name of ["clean", "chaotic", "codex"]) {
      const res = await get(`/api/demo?name=${name}`);
      expect(res.status).toBe(200);
    }
  });

  it("404s unknown demo names", async () => {
    const res = await get("/api/demo?name=nope");
    expect(res.status).toBe(404);
  });
});

describe("routing", () => {
  it("404s unknown routes", async () => {
    const res = await get("/nothing/here");
    expect(res.status).toBe(404);
  });

  it("405s DELETE on known routes", async () => {
    const res = await rawRequest("DELETE", "/health");
    expect(res.status).toBe(405);
  });
});
