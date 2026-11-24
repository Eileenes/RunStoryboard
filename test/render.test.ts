import { describe, expect, it } from "vitest";
import { renderStoryboardSvg, esc } from "../src/render/svg";
import { renderStoryboardHtml, renderFull } from "../src/render/html";
import { storyboardFromTranscript } from "../src";
import * as fs from "node:fs";
import * as path from "node:path";

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "..", "examples", name), "utf8");
}

function boardFor(name: string) {
  return storyboardFromTranscript(fixture(name), "auto").storyboard;
}

describe("XML escaping", () => {
  it("escapes all five XML specials", () => {
    expect(esc(`<a & "b" 'c' >`)).toBe("&lt;a &amp; &quot;b&quot; &apos;c&apos; &gt;");
  });

  it("never emits raw angle brackets from transcript content", () => {
    const raw = '{"role":"user","content":"<script>alert(1 & 2)</script>"}';
    const { storyboard } = storyboardFromTranscript(raw, "auto");
    const svg = renderStoryboardSvg(storyboard);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});

describe("determinism", () => {
  it("renders byte-identical SVG for identical input", () => {
    const board = boardFor("chaotic-session.jsonl");
    expect(renderStoryboardSvg(board)).toBe(renderStoryboardSvg(board));
  });

  it("renders byte-identical HTML for identical input", () => {
    const board = boardFor("clean-session.jsonl");
    const a = renderFull(board).html;
    const b = renderFull(board).html;
    expect(a).toBe(b);
  });
});

describe("board content", () => {
  it("contains header stats and step titles", () => {
    const board = boardFor("chaotic-session.jsonl");
    const svg = renderStoryboardSvg(board);
    expect(svg).toContain("Add a /health endpoint");
    expect(svg).toContain("TOOL");
    expect(svg).toContain("ERROR");
    expect(svg).toContain("LOOP?");
    expect(svg).toContain("FINDINGS");
    expect(svg).toContain("runstoryboard");
  });

  it("marks parallel groups with index badges", () => {
    const board = boardFor("chaotic-session.jsonl");
    const svg = renderStoryboardSvg(board);
    expect(svg).toContain("1/2");
    expect(svg).toContain("2/2");
  });

  it("clean session shows no error badges", () => {
    const board = boardFor("clean-session.jsonl");
    const svg = renderStoryboardSvg(board);
    expect(svg).not.toContain(">ERROR<");
    expect(svg).not.toContain("LOOP?");
  });

  it("scales height with the number of steps", () => {
    const small = renderStoryboardSvg(boardFor("clean-session.jsonl"));
    const big = renderStoryboardSvg(boardFor("chaotic-session.jsonl"));
    const hOf = (s: string) => Number(/height="(\d+)"/.exec(s)?.[1]);
    expect(hOf(big)).toBeGreaterThan(hOf(small));
  });
});

describe("HTML wrapper", () => {
  it("is fully self-contained: no external references", () => {
    const { html } = renderFull(boardFor("chaotic-session.jsonl"));
    // the only permitted URL is the SVG xmlns namespace declaration
    const withoutXmlns = html.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "");
    expect(withoutXmlns).not.toMatch(/https?:\/\//);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<svg");
  });

  it("embeds findings JSON", () => {
    const board = boardFor("chaotic-session.jsonl");
    const { html } = renderFull(board);
    expect(html).toContain("findings data");
  });
});
