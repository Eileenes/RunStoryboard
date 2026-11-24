import type { Annotation, Step, Storyboard } from "../types";

/**
 * Deterministic SVG renderer — the storyboard itself.
 *
 * Editorial flat style: no shadows, no gradients, 1px hairlines, restrained
 * ink-on-paper palette (echoing the diagram-design school: the picture should
 * look typeset, not decorated). Pure string building; identical input always
 * produces byte-identical output.
 */

const W = 880;
const PAD_X = 24;
const CARD_X = 96;
const CARD_W = W - CARD_X - PAD_X;

const INK = "#1F1D1A";
const MUTED = "#6B675E";
const FAINT = "#A8A296";
const HAIR = "#E5E1D8";
const PAPER = "#FAF9F6";
const CARD_BG = "#FFFFFF";

const SPINE: Record<string, string> = {
  "user:info": "#35569E",
  "assistant_text:info": "#2E6E5A",
  "tool:info": "#7A6A9E",
  "tool:ok": "#2E6E5A",
  "tool:error": "#B23A2E",
  "system:info": "#8A8578",
  "unknown:info": "#A8A296",
};

function spineColor(step: Step): string {
  return SPINE[`${step.kind}:${step.status}`] ?? SPINE["unknown:info"] ?? FAINT;
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const SANS = `-apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

/** SVG <text> never wraps — hard-fit every line to the card interior. */
function fit(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars - 1) + "…";
}

const CHARS_SANS = 100; // ~7.2px/char at 12.5px inside 720px card
const CHARS_MONO = 106; // ~6.6px/char at 11px inside 720px card

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

function timeOf(ts: number | undefined, t0: number | undefined): string | null {
  if (ts === undefined) return null;
  if (t0 !== undefined) {
    const d = ts - t0;
    if (d >= 0 && d < 3_600_000) return `+${fmtMs(d)}`;
  }
  const dt = new Date(ts);
  if (Number.isNaN(dt.getTime())) return null;
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  const ss = String(dt.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

interface CardLayout {
  step: Step;
  y: number;
  h: number;
  main: string;
  extras: { text: string; mono: boolean; color: string }[];
  badges: Annotation[];
  time: string | null;
}

/** Compose the full board, measuring each card as we go. */
export function renderStoryboardSvg(board: Storyboard): string {
  const { steps, stats, annotations, title } = board;
  const bySeqBadges = new Map<number, Annotation[]>();
  for (const a of annotations) {
    if (a.type === "loop" || a.type === "parallel") continue; // shown once, in the margin
    for (const seq of a.seqs) {
      const arr = bySeqBadges.get(seq) ?? [];
      arr.push(a);
      bySeqBadges.set(seq, arr);
    }
  }
  const loopSet = new Set<number>();
  const parSet = new Set<number>();
  for (const a of annotations) {
    if (a.type === "loop") a.seqs.forEach((s) => loopSet.add(s));
    if (a.type === "parallel") a.seqs.forEach((s) => parSet.add(s));
  }

  const t0 = steps.find((s) => s.ts !== undefined)?.ts;
  const cards: CardLayout[] = [];
  let y = 0;
  for (const step of steps) {
    // line stack: [main, ...extras] — one 20px row each
    const redundantTitle =
      (step.kind === "user" && step.title === "user") ||
      (step.kind === "assistant_text" && step.title === "assistant");
    const main = redundantTitle ? (step.detail ?? step.title) : step.title;
    const extras: { text: string; mono: boolean; color: string }[] = [];
    if (!redundantTitle && step.detail) {
      extras.push({ text: fit(step.detail, CHARS_SANS), mono: false, color: INK });
    }
    if (step.argsSummary) {
      extras.push({ text: fit(step.argsSummary, CHARS_MONO), mono: true, color: MUTED });
    }
    if (step.resultDetail) {
      const prefix = step.status === "error" ? "✗ " : "→ ";
      extras.push({ text: fit(prefix + step.resultDetail, CHARS_MONO), mono: true, color: step.status === "error" ? "#B23A2E" : MUTED });
    }
    const h = 24 + 26 + extras.length * 20 + 16;
    cards.push({
      step,
      y,
      h,
      extras,
      main: fit(main, CHARS_SANS + 20),
      badges: bySeqBadges.get(step.seq) ?? [],
      time: timeOf(step.ts, t0),
    });
    y += h + 14;
  }

  const headerH = 132;
  const annotationsH =
    annotations.length > 0 ? 40 + annotations.length * 24 : 0;
  const footerH = 64;
  const H = headerH + y + annotationsH + footerH;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='${SANS}'>`,
  );
  parts.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);

  // ---- header -------------------------------------------------------------
  parts.push(`<text x="${PAD_X}" y="44" font-size="24" font-weight="700" fill="${INK}">${esc(title)}</text>`);
  parts.push(
    `<text x="${PAD_X}" y="68" font-size="12" fill="${MUTED}" font-family='${MONO}'>runstoryboard · ${esc(stats.format)} format · ${stats.totalSteps} steps</text>`,
  );
  const chips: string[] = [];
  chips.push(`${stats.toolCalls} tool calls`);
  if (stats.errors > 0) chips.push(`${stats.errors} errors`);
  if (stats.retries > 0) chips.push(`${stats.retries} retries`);
  if (stats.loopSuspects > 0) chips.push(`${stats.loopSuspects} loop?`);
  if (stats.parallelGroups > 0) chips.push(`${stats.parallelGroups} parallel`);
  chips.push(`${stats.userMessages} user / ${stats.assistantTexts} assistant`);
  if (stats.durationMs !== null) chips.push(fmtMs(stats.durationMs));
  let cx = PAD_X;
  for (const chip of chips) {
    const w = 14 + chip.length * 6.6;
    parts.push(
      `<rect x="${cx}" y="82" rx="3" width="${w.toFixed(1)}" height="22" fill="none" stroke="${HAIR}"/>` +
        `<text x="${cx + 7}" y="97" font-size="11" font-family='${MONO}' fill="${MUTED}">${esc(chip)}</text>`,
    );
    cx += w + 8;
  }
  parts.push(`<line x1="${PAD_X}" y1="118" x2="${W - PAD_X}" y2="118" stroke="${HAIR}"/>`);

  // ---- cards --------------------------------------------------------------
  for (const card of cards) {
    const { step } = card;
    const cy = headerH + card.y;
    const color = spineColor(step);
    const isErr = step.status === "error";

    // left rail: seq + time
    parts.push(
      `<text x="${PAD_X}" y="${cy + 22}" font-size="11" font-family='${MONO}' fill="${FAINT}">#${step.seq}</text>`,
    );
    if (card.time) {
      parts.push(
        `<text x="${PAD_X}" y="${cy + 38}" font-size="10" font-family='${MONO}' fill="${FAINT}">${esc(card.time)}</text>`,
      );
    }

    // card
    parts.push(
      `<rect x="${CARD_X}" y="${cy}" width="${CARD_W}" height="${card.h}" rx="4" fill="${CARD_BG}" stroke="${isErr ? "#D8A79F" : HAIR}"/>`,
    );
    parts.push(`<rect x="${CARD_X}" y="${cy}" width="4" height="${card.h}" rx="2" fill="${color}"/>`);

    // kind label + title
    const kindLabel =
      step.kind === "tool"
        ? `TOOL${step.parallelSize !== undefined ? ` ${step.parallelIndex}/${step.parallelSize}` : ""}`
        : step.kind === "user"
          ? "USER"
          : step.kind === "assistant_text"
            ? "ASSISTANT"
            : step.kind.toUpperCase();
    const ty = cy + 22;
    parts.push(
      `<text x="${CARD_X + 20}" y="${ty}" font-size="10" letter-spacing="1" font-family='${MONO}' fill="${MUTED}">${esc(kindLabel)}</text>`,
    );
    if (isErr) {
      const badge = "ERROR";
      const bw = 8 + badge.length * 7;
      parts.push(
        `<rect x="${CARD_X + CARD_W - bw - 14}" y="${cy + 10}" rx="3" width="${bw}" height="18" fill="#F6E3DF"/>` +
          `<text x="${CARD_X + CARD_W - bw - 7}" y="${cy + 23}" font-size="10" font-weight="700" font-family='${MONO}' fill="#B23A2E">${badge}</text>`,
      );
    }
    if (loopSet.has(step.seq)) {
      const badge = "LOOP?";
      const bw = 8 + badge.length * 7;
      const bx = isErr ? CARD_X + CARD_W - 70 - bw - 8 : CARD_X + CARD_W - bw - 14;
      parts.push(
        `<rect x="${bx}" y="${cy + 10}" rx="3" width="${bw}" height="18" fill="#F3EBDD"/>` +
          `<text x="${bx + 7}" y="${cy + 23}" font-size="10" font-weight="700" font-family='${MONO}' fill="#8A6A2F">${badge}</text>`,
      );
    }

    // main line + extras: a line stack, every line hard-fitted to the card
    let ly = cy + 44;
    parts.push(
      `<text x="${CARD_X + 20}" y="${ly}" font-size="${step.kind === "tool" ? 13.5 : 12.5}" font-weight="600" fill="${INK}" font-family='${step.kind === "tool" ? MONO : SANS}'>${esc(card.main)}</text>`,
    );
    ly += 20;
    for (const line of card.extras) {
      const isBody = line.color === INK;
      parts.push(
        `<text x="${CARD_X + 20}" y="${ly}" font-size="${line.mono ? 11 : 12}" fill="${line.color}" opacity="${isBody ? "0.85" : "1"}" font-family='${line.mono ? MONO : SANS}'>${esc(line.text)}</text>`,
      );
      ly += 20;
    }

    // retry badge from annotations
    for (const b of card.badges) {
      if (b.type !== "retry") continue;
      const label = `retry ×${b.seqs.length - 1}`;
      const bw = 8 + label.length * 6.6;
      parts.push(
        `<rect x="${CARD_X + CARD_W - bw - 14}" y="${cy + card.h - 26}" rx="3" width="${bw}" height="18" fill="#F3EBDD"/>` +
          `<text x="${CARD_X + CARD_W - bw - 7}" y="${cy + card.h - 13}" font-size="10" font-weight="700" font-family='${MONO}' fill="#8A6A2F">${esc(label)}</text>`,
      );
    }
  }

  // ---- annotations summary ------------------------------------------------
  if (annotations.length > 0) {
    let ay = headerH + y + 40;
    parts.push(`<line x1="${PAD_X}" y1="${ay - 24}" x2="${W - PAD_X}" y2="${ay - 24}" stroke="${HAIR}"/>`);
    parts.push(
      `<text x="${PAD_X}" y="${ay - 6}" font-size="11" letter-spacing="1" font-family='${MONO}' fill="${MUTED}">FINDINGS</text>`,
    );
    for (const a of annotations) {
      const seqLabel = a.seqs.length > 4 ? `#${a.seqs[0]}–#${a.seqs[a.seqs.length - 1]}` : a.seqs.map((s) => `#${s}`).join(" ");
      const dot =
        a.type === "loop" || a.type === "retry" ? "#8A6A2F" : a.type === "parallel" ? "#35569E" : "#8A8578";
      parts.push(
        `<circle cx="${PAD_X + 4}" cy="${ay + 6}" r="3" fill="${dot}"/>` +
          `<text x="${PAD_X + 16}" y="${ay + 10}" font-size="12" fill="${INK}">${esc(a.note)}</text>` +
          `<text x="${W - PAD_X}" y="${ay + 10}" font-size="11" text-anchor="end" font-family='${MONO}' fill="${FAINT}">${esc(seqLabel)}</text>`,
      );
      ay += 24;
    }
  }

  // ---- footer -------------------------------------------------------------
  const fy = H - 28;
  parts.push(`<line x1="${PAD_X}" y1="${fy - 18}" x2="${W - PAD_X}" y2="${fy - 18}" stroke="${HAIR}"/>`);
  parts.push(
    `<text x="${PAD_X}" y="${fy}" font-size="10" font-family='${MONO}' fill="${FAINT}">generated by runstoryboard — deterministic transcript diagram, no AI in the loop</text>`,
  );

  parts.push(`</svg>`);
  return parts.join("\n");
}
