import type { Storyboard } from "../types";
import { esc, renderStoryboardSvg } from "./svg";

/**
 * Self-contained HTML wrapper around the SVG board.
 * Zero external references: no CDN, no fonts, no images — the file is the
 * artifact, safe to attach to a PR, a postmortem, or a blog post.
 */
export function renderStoryboardHtml(board: Storyboard, svg: string): string {
  const findingsJson = esc(JSON.stringify(board.annotations));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RunStoryboard — ${esc(board.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #FAF9F6; color: #1F1D1A;
         font-family: -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
  header { padding: 28px 24px 8px; }
  header h1 { margin: 0; font-size: 15px; font-weight: 600; color: #6B675E; letter-spacing: .04em; }
  header p { margin: 4px 0 0; font-size: 12px; color: #A8A296; font-family: ui-monospace, Menlo, monospace; }
  main { max-width: 920px; margin: 0 auto; padding: 12px 16px 48px; }
  .board { border: 1px solid #E5E1D8; border-radius: 6px; background: #fff; overflow-x: auto; }
  .board svg { display: block; }
  details { margin-top: 16px; }
  summary { cursor: pointer; font-size: 12px; color: #6B675E; font-family: ui-monospace, Menlo, monospace; }
  pre { background: #fff; border: 1px solid #E5E1D8; border-radius: 6px; padding: 12px;
        font-size: 11px; overflow-x: auto; }
</style>
</head>
<body>
<header>
  <h1>RUNSTORYBOARD</h1>
  <p>deterministic agent-run diagram · same transcript in, same board out</p>
</header>
<main>
  <div class="board">
${svg}
  </div>
  <details>
    <summary>findings data (JSON)</summary>
    <pre>${findingsJson}</pre>
  </details>
</main>
</body>
</html>
`;
}

export function renderFull(board: Storyboard): { svg: string; html: string } {
  const svg = renderStoryboardSvg(board);
  return { svg, html: renderStoryboardHtml(board, svg) };
}
