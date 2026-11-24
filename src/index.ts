import { analyze } from "./analyze";
import { renderFull } from "./render/html";
import { parseTranscript } from "./parsers";
import type { FormatName, ParseResult, Storyboard } from "./types";

export { parseTranscript, detectFormat } from "./parsers";
export { analyze } from "./analyze";
export { renderFull, renderStoryboardHtml } from "./render/html";
export { renderStoryboardSvg } from "./render/svg";
export * from "./types";

/**
 * One-call pipeline: raw transcript text -> finished storyboard.
 * This is the API surface the CLI and the web server both share.
 */
export function storyboardFromTranscript(raw: string, format: FormatName = "auto"): {
  storyboard: Storyboard;
  warnings: string[];
} {
  const parsed: ParseResult = parseTranscript(raw, format);
  const { annotations, stats } = analyze(parsed.storyboard.steps);
  parsed.storyboard.annotations = annotations;
  parsed.storyboard.stats = { ...stats, format: parsed.storyboard.stats.format };
  return { storyboard: parsed.storyboard, warnings: parsed.warnings };
}

export function renderTranscript(raw: string, format: FormatName = "auto"): {
  storyboard: Storyboard;
  svg: string;
  html: string;
  warnings: string[];
} {
  const { storyboard, warnings } = storyboardFromTranscript(raw, format);
  const { svg, html } = renderFull(storyboard);
  return { storyboard, svg, html, warnings };
}
