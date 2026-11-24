# RunStoryboard

[English](#english) | [中文](#中文)

---

<a id="english"></a>

## English

**Turn any AI agent session transcript into a deterministic, self-contained storyboard diagram.** No LLM, no network, no dependencies — the same transcript always produces the same board.

Agent coding tools (Claude Code, Codex CLI, and every harness in between) record every session as a JSONL transcript. When a run misbehaves — retries, loops, silent failures, burned tokens — you read raw JSONL by eye. Meanwhile, the "agents that draw diagrams" wave (diagram-design, Archify, stack-diagram) produces beautiful *architecture* pictures from prompts, but nothing renders the **run itself** — deterministically, event by event.

RunStoryboard is that missing renderer: a transcript goes in, an editorial flat-style board comes out — every step, every tool call with its result attached, plus deterministic findings (retry chains, loop suspects, parallel invocations, long outputs) that don't depend on any model's mood.

### Features

- **Three transcript parsers + auto-detect**: Claude Code sessions (`~/.claude/projects/**.jsonl`), Codex CLI rollouts (`~/.codex/sessions/**rollout-*.jsonl`), and a generic role/content JSONL heuristic for anything else
- **Deterministic findings**, not vibes: retry chains (same tool failed then retried), loop suspects (≥3 identical tool+args calls), parallel invocations (one turn, several tool calls), long outputs (pre-truncation flag)
- **Self-contained HTML output**: inline SVG, zero external references (no CDN, no web fonts) — attach it to a PR, a postmortem, or a blog post
- **Editorial flat style**: 1px hairlines, ink-on-paper palette, no shadows, no gradients; tool calls in monospace, prose in sans
- **Built-in console**: paste or upload a transcript, click a demo, see the board — all locally, nothing leaves the machine
- **Zero runtime dependencies**: TypeScript strict mode on `node:fs` / `node:http` only; `npx runstoryboard` works anywhere
- **74 tests** (parsers, analysis, rendering determinism, server, CLI) — byte-identical output is asserted, not assumed

### Quick start

```bash
# zero-install: render any transcript to a self-contained HTML board
npx runstoryboard render ~/.claude/projects/<proj>/<session>.jsonl

# first look: render the bundled chaotic example
npx runstoryboard demo            # writes storyboard-demo.html

# raw SVG or machine-readable stats instead
npx runstoryboard render session.jsonl --svg --out board.svg
npx runstoryboard render session.jsonl --json

# preview console with paste/upload + demos
npx runstoryboard serve           # http://localhost:7420
```

Docker:

```bash
docker compose up --build         # console on http://localhost:7420
```

### CLI

```
runstoryboard render <transcript.jsonl> [--format auto|claude|codex|generic]
                        [--out board.html] [--json] [--svg]
runstoryboard demo   [--out storyboard-demo.html]
runstoryboard serve  [--port 7420]
```

| Flag | Meaning |
| --- | --- |
| `--format` | Force a parser (default: auto-detect from the first 20 lines) |
| `--out` | Output path (default: `<input>.storyboard.html`) |
| `--json` | Print stats + findings as JSON instead of writing the board |
| `--svg` | Write raw SVG instead of the HTML wrapper |
| `--port` | Server port for `serve` (default: 7420) |

### API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness: `{"status":"ok","service":"runstoryboard"}` |
| GET | `/` | Preview console |
| GET | `/static/<file>` | Static assets (path-traversal guarded) |
| POST | `/api/render` | Body `{"content": "<jsonl>", "format": "auto"}` → `{html, svg, stats, annotations, warnings}` |
| GET | `/api/demo?name=clean\|chaotic\|codex` | Bundled example transcript |

Wrong method → `405`; unknown route → `404`; bodies over 8 MB → rejected.

### Findings reference

| Type | Trigger | Meaning |
| --- | --- | --- |
| `retry` | Same tool failed, then the same tool was called again (before a new user turn) | `Bash failed 1× before succeeding` |
| `loop` | ≥3 calls with the same tool + identical arguments | `Bash called 4× with identical arguments — likely a loop` |
| `parallel` | One assistant turn emitted several tool calls | `2 tools invoked in parallel` |
| `long_output` | Assistant text over the readability threshold (flagged pre-truncation) | board truncates the card, data keeps the count |

All findings are pure sequence/set logic over parsed steps — no prose heuristics, no LLM.

### Project structure

```
runstoryboard/
├── src/
│   ├── types.ts        # Step / Storyboard / Annotation model
│   ├── parsers/        # claude.ts · codex.ts · generic.ts · auto-detect
│   ├── analyze/        # retry chains · loops · parallel · stats
│   ├── render/         # svg.ts (editorial board) · html.ts (self-contained page)
│   ├── server.ts       # console + /api/render
│   ├── cli.ts          # hand-rolled arg parsing (order-independent flags)
│   └── index.ts        # one-call pipeline API
├── static/console.html # preview console (vanilla JS)
├── examples/           # clean · chaotic · codex fixtures
├── test/               # 74 Vitest tests
├── Dockerfile          # node:22-alpine, non-root, read_only, healthcheck
└── docker-compose.yml  # cap_drop ALL, no-new-privileges
```

### Tech stack

TypeScript 5.7 (strict) · Node ≥18, zero runtime dependencies · Vitest · Docker (node:22-alpine, non-root `uid 10001`, `read_only`, `cap_drop ALL`, built-in healthcheck).

### License

MIT

---

<a id="中文"></a>

## 中文

**把任意 AI agent 会话 transcript 变成确定性的、自包含的运行分镜图。** 不用大模型、不联网、零依赖——同一份 transcript 永远画出同一张图。

Agent 编码工具（Claude Code、Codex CLI 以及各种 harness）都会把每次会话记录成 JSONL transcript。当一次运行出问题时——重试、循环、静默失败、token 烧穿——你只能肉眼翻原始 JSONL。与此同时，"agent 画图"浪潮（diagram-design、Archify、stack-diagram）用提示词生成漂亮的**架构图**，却没有工具把**运行本身**确定性地、逐事件地画出来。

RunStoryboard 就是缺的那块：transcript 进，编辑部扁平风分镜图出——每个步骤、每次工具调用（结果合并进卡片），外加不依赖任何模型心情的确定性发现（重试链、疑似循环、并行调用、超长输出）。

### 功能列表

- **三种 transcript 解析器 + 自动识别**：Claude Code 会话（`~/.claude/projects/**.jsonl`）、Codex CLI rollout（`~/.codex/sessions/**rollout-*.jsonl`）、通用 role/content JSONL 启发式兜底
- **确定性发现，不是感觉**：重试链（同工具失败后再调）、疑似循环（同工具+同参数 ≥3 次）、并行调用（一轮多个工具）、超长输出（截断前标记）
- **自包含 HTML 输出**：内联 SVG、零外部引用（无 CDN、无网络字体）——可以直接贴进 PR、复盘文档或博客
- **编辑部扁平风格**：1px 细线、纸墨配色、无阴影无渐变；工具调用等宽字体、正文无衬线
- **内置控制台**：粘贴或上传 transcript、点 demo 看图——全部本地完成，数据不出机器
- **零运行时依赖**：TypeScript strict，只用 `node:fs` / `node:http`；`npx runstoryboard` 到处能跑
- **74 个测试**（解析、分析、渲染确定性、服务端、CLI）——字节级一致的输出是测出来的，不是假设的

### 快速开始

```bash
# 免安装：把任意 transcript 渲染成自包含 HTML 分镜
npx runstoryboard render ~/.claude/projects/<项目>/<会话>.jsonl

# 第一次看：渲染内置的混乱示例
npx runstoryboard demo            # 生成 storyboard-demo.html

# 要原始 SVG 或机器可读统计
npx runstoryboard render session.jsonl --svg --out board.svg
npx runstoryboard render session.jsonl --json

# 带粘贴/上传的预览控制台
npx runstoryboard serve           # http://localhost:7420
```

Docker：

```bash
docker compose up --build         # 控制台在 http://localhost:7420
```

### CLI

```
runstoryboard render <transcript.jsonl> [--format auto|claude|codex|generic]
                        [--out board.html] [--json] [--svg]
runstoryboard demo   [--out storyboard-demo.html]
runstoryboard serve  [--port 7420]
```

| 参数 | 含义 |
| --- | --- |
| `--format` | 强制指定解析器（默认：按前 20 行自动识别） |
| `--out` | 输出路径（默认：`<输入名>.storyboard.html`） |
| `--json` | 打印统计+发现的 JSON，不写图 |
| `--svg` | 输出原始 SVG 而不是 HTML 包装 |
| `--port` | `serve` 的端口（默认：7420） |

### API 文档

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 存活检查：`{"status":"ok","service":"runstoryboard"}` |
| GET | `/` | 预览控制台 |
| GET | `/static/<file>` | 静态资源（防路径穿越） |
| POST | `/api/render` | Body `{"content": "<jsonl>", "format": "auto"}` → `{html, svg, stats, annotations, warnings}` |
| GET | `/api/demo?name=clean\|chaotic\|codex` | 内置示例 transcript |

错误方法 → `405`；未知路由 → `404`；超过 8 MB 的请求体 → 拒绝。

### 发现（findings）规则

| 类型 | 触发条件 | 含义 |
| --- | --- | --- |
| `retry` | 同一工具失败后又调用了同一工具（用户新发言之前） | `Bash failed 1× before succeeding` |
| `loop` | 同工具+完全相同参数的调用 ≥3 次 | `Bash called 4× with identical arguments — likely a loop` |
| `parallel` | 一条 assistant 消息同时发出多个工具调用 | `2 tools invoked in parallel` |
| `long_output` | assistant 文本超过可读阈值（截断前标记） | 卡片上截断显示，数据里保留标记 |

所有发现都是对解析后步骤的纯序列/集合逻辑——没有对散文的启发式，没有 LLM。

### 项目结构

```
runstoryboard/
├── src/
│   ├── types.ts        # Step / Storyboard / Annotation 数据模型
│   ├── parsers/        # claude.ts · codex.ts · generic.ts · 自动识别
│   ├── analyze/        # 重试链 · 循环 · 并行 · 统计
│   ├── render/         # svg.ts（分镜图）· html.ts（自包含页面）
│   ├── server.ts       # 控制台 + /api/render
│   ├── cli.ts          # 手写参数解析（flag 顺序无关）
│   └── index.ts        # 一次调用完成全流程的 API
├── static/console.html # 预览控制台（原生 JS）
├── examples/           # clean · chaotic · codex 三个示例
├── test/               # 74 个 Vitest 测试
├── Dockerfile          # node:22-alpine，非 root，read_only，健康检查
└── docker-compose.yml  # cap_drop ALL，no-new-privileges
```

### 技术栈

TypeScript 5.7（strict）· Node ≥18，零运行时依赖 · Vitest · Docker（node:22-alpine，非 root `uid 10001`，`read_only`，`cap_drop ALL`，内置健康检查）。

### License

MIT
