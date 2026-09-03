# CodeYantram

A terminal-based AI coding assistant. CodeYantram brings an LLM agent into your terminal — chat with the model, and let it read, search, edit, and execute against your project — all with full streaming, a built-in approval gate for anything that mutates, and a small local server that keeps the TUI and the model providers separated.

Built with **Bun**, **OpenTUI** (a React-based TUI renderer), **Hono**, and the **Vercel AI SDK**.

## Features

- **In-terminal chat UI** — OpenTUI/React interface with streaming markdown rendering, live deltas, a "Thinking…" spinner, and tool-call status (`running…`, `done`, `needs approval`, `denied`).
- **Multi-provider support** — Anthropic, OpenAI, Google, and DeepSeek from one catalog, each with its own API key.
- **Reasoning effort control** — models that support it expose per-model effort levels (`none` → `max`), validated before a request is ever sent.
- **Two agents with graduated tool access**:
  - **Talk** — read-only tools (`read_file`, `list_dir`, `glob`, `grep`) plus `web_fetch` to read a URL — the one Talk tool that still asks for approval, since it leaves the machine.
  - **Build** — the full tool catalog, including mutating tools (`edit_file`, `write_file`, `bash`).
- **Tool approval gate** — every mutating tool pauses mid-turn and asks for explicit approval (`y`/`n`) before it runs.
- **Streaming SSE protocol** — one wire format for success *and* failure; cancel is just closing the connection.
- **Local persistence** — API keys (`auth.json`, `0600`) and preferences (`preferences.json`) under `~/.codeyantram/`.
- **12 hand-tuned themes** and tree-sitter syntax highlighting across 17+ languages.
- **Slash-command menu** with autocomplete (`/new`, `/agents`, `/models`, `/connect`, `/themes`, `/exit`, …).
- **Sandboxed tool paths** — every tool path is resolved against the project root and can never escape it.
- **Single-flight turns** — one response in flight at a time; escape/ctrl+c cancels cleanly.

## Architecture

CodeYantram is a **Bun workspace monorepo** with three packages:

```
codeyantram/
├── packages/
│   ├── cli/      # The terminal UI (OpenTUI + React)
│   ├── server/   # Local Hono server: model routing + tool execution
│   └── shared/   # Zod schemas, catalogs, and pure logic shared by both
```

The **CLI** never talks to a model directly. It POSTs a chat request to the local **server**, which resolves the provider/model/API key, streams the response back over **SSE**, and executes any tool calls against the project root. The **shared** package defines the contract between them — schemas, the model/tool/agent catalogs, and stream-folding logic — so both sides can't drift apart.

## Getting Started

### Prerequisites

- **Bun 1.3.0+** (the CLI, server, and tests all run on Bun)
- A terminal with a modern color/UTF-8 profile

### Install

```bash
bun install
```

### Configure API keys

Keys can be provided either way (checked in this order):

1. **In-app** — run `/connect` in the CLI, pick a provider, and paste a key. Stored in `~/.codeyantram/auth.json` with `0600` permissions.
2. **Environment variables** — copy `.env.example` to `.env` and fill in keys:

```bash
# .env
API_URL=http://localhost:3001
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
DEEPSEEK_API_KEY=
```

The server checks the `/connect` auth store first, then falls back to the env var — a key set either way works at chat time.

### Run

```bash
# Terminal 1 — start the local server (default port 3001)
bun run dev:server

# Terminal 2 — start the TUI
bun run dev:cli
```

Run both in the project root you want the agent to work on — the server resolves every tool path against the directory it was launched from.

## Usage

### Keybindings

| Key | Action |
| --- | --- |
| `enter` | Send message |
| `shift+enter` | Insert a newline in the input |
| `tab` | Cycle agents (Talk ⇄ Build) |
| `escape` | Cancel an in-flight stream; otherwise clear the prompt |
| `ctrl+c` | Clear the prompt; quit when the prompt is empty |
| `↑` / `↓` / `enter` / `tab` / `escape` | Navigate menus and overlays (when one owns the keyboard) |

### Slash commands

Type `/` in the input bar for an autocompleting menu:

| Command | Description |
| --- | --- |
| `/new` | Start a new session |
| `/agents` | Switch agent (Talk / Build) |
| `/models` | Switch model |
| `/connect` | Connect a provider with an API key (or clear one) |
| `/sessions` | Switch session |
| `/themes` | Switch theme |
| `/upgrade` | Upgrade CodeYantram |
| `/support` | Get support |
| `/exit` | Exit the app |

### Agents

- **Talk** (default) — chat and *read* the project. Exposed tools are read-only, so it's safe for exploration.
- **Build** — full agent. Can edit files, write files, and run shell commands — each mutating call pauses for your approval first.

Switch between them with `tab` or `/agents`; the current agent is shown in the input bar.

### Models

The catalog is defined in `packages/shared/src/models.ts`:

| Provider | Models | Effort levels |
| --- | --- | --- |
| Anthropic | `claude-sonnet-5`, `claude-opus-5`, `claude-haiku-4-5` | `low` → `max` (haiku: none) |
| OpenAI | `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano` | `none` → `xhigh` |
| Google | `gemini-3.5-flash` | `minimal` → `high` |
| DeepSeek | `deepseek-v4-flash`, `deepseek-v4-pro` | — |

Default: `claude-sonnet-5` with `high` effort. A model is only offered in `/models` if its provider has a key configured.

### Themes

Twelve built-in themes (Sahyadri, Kaapi, Thirai, Konkan, Sanganak, Aranya, Gulabi, Bazaar, Shishir, Ladakh, Oviya, Kaadu), switchable via `/themes`. Theme, model, and agent preferences persist across restarts.

## Tools

Defined in `packages/shared/src/tools.ts` and executed by the server against the project root:

| Tool | Description | Access |
| --- | --- | --- |
| `read_file` | Read a file's contents | Read-only (Talk + Build) |
| `list_dir` | List a directory's entries | Read-only |
| `glob` | Find files matching a glob | Read-only |
| `grep` | Regex-search file contents | Read-only |
| `edit_file` | Replace one exact, unique snippet | **Requires approval** (Build) |
| `write_file` | Create/overwrite a file | **Requires approval** (Build) |
| `bash` | Run a shell command (30s timeout) | **Requires approval** (Build) |
| `web_fetch` | Fetch a URL and return its content as text | **Requires approval** (Talk + Build) |

### The approval flow

1. The model calls a mutating tool → the server sends a `tool-approval-request` event and **pauses the turn**.
2. The CLI shows an **Approve tool call** overlay with the tool name and arguments.
3. `y` / `enter` approves, `n` denies, `escape`/`ctrl+c` counts as a denial.
4. The CLI records the decision, then automatically starts a new turn that replays it — the server acts on it and streams back the tool result.

Read-only tools run immediately with no prompt. `web_fetch` always needs approval, even in Talk, since it's the one tool that leaves the machine. A tool loop is capped at 15 steps to guard against a confused model looping forever.

### Network access

`web_fetch` is the only tool that reaches outside the project — everything else in the catalog is filesystem/shell-only, sandboxed to the project root. Its policy (`packages/server/src/tools/url-policy.ts` and `web-fetch.ts`):

- **https only, GET only.** No other scheme or method; the model can't set headers, cookies, or credentials — anything behind a login is unreachable.
- **No private/internal targets.** A loopback, link-local, RFC 1918, or otherwise non-public address is refused, whether given directly or reached via DNS or a redirect. Every redirect hop (up to 5) is re-validated against the same policy, not just the original URL.
- **Bounded like every other tool.** 5 MB response cap (post-decompression), 30s timeout, output paged and line-numbered like `read_file`. A content type this tool doesn't handle (PDF, images, archives, …) is refused before its body is even read.
- **Untrusted by design.** Fetched content comes back wrapped in an explicit `BEGIN`/`END UNTRUSTED FETCHED CONTENT` frame with a warning — the system prompt tells the model never to treat it as instructions.

Two environment variables (see `.env.example`) let you deliberately loosen the private-address check for a controlled target, e.g. an internal docs server:

- `WEB_FETCH_ALLOW_PRIVATE=1` — allow fetching private/loopback/internal addresses. The https-only rule is unaffected — the target still needs a valid TLS certificate. Off by default.
- `WEB_FETCH_DENY_HOSTS` — a comma-separated hostname blocklist, checked before anything else and enforced even with `WEB_FETCH_ALLOW_PRIVATE` set.

## How It Works

### Chat request

The CLI POSTs a JSON `ChatRequest` to `POST /chat`:

```json
{
  "model": "claude-sonnet-5",
  "effort": "high",
  "agent": "Build",
  "cwd": "/path/to/project",
  "messages": [
    { "id": "...", "role": "user", "parts": [{ "type": "text", "text": "fix the socket handshake" }] }
  ]
}
```

Reasoning parts are stripped before replay (`toRequestMessage`) — Anthropic thinking blocks carry signatures this format doesn't keep, so replaying them would be worse than omitting them.

### SSE stream protocol

The server replies with an SSE stream of JSON events (one per `data:` line):

| Event | Purpose |
| --- | --- |
| `start` | Announces the assistant message id before any content |
| `text-delta` | Streaming text fragment |
| `reasoning-delta` | Streaming reasoning fragment |
| `tool-call` | A tool invocation (name, id, args) |
| `tool-result` | A tool's output, folded into its call |
| `tool-approval-request` | A mutating tool waiting on the user |
| `done` | Turn complete (`durationMs`) |
| `error` | Failure (`code` + `message`) |

A stream always opens with `start` and closes with `done` or `error`. A connection that closes with neither means the request was **aborted** — a normal outcome, not a failure. Errors (including a missing API key) are delivered as `error` events on the stream rather than HTTP error statuses, so the CLI has exactly one code path for success and failure.

### Streaming pipeline

- **Server** (`packages/server/src/lib/chat-stream.ts`) — resolves the model/key, calls `streamText` with the right tools for the agent, and forwards every part as an SSE event.
- **CLI** (`packages/cli/src/api/chat.ts`) — buffers the SSE stream, splits on record boundaries, validates each event against the schema (bad lines are skipped, not fatal), and yields parsed events.
- **Shared folding** (`packages/shared/src/stream.ts` — `applyStreamEvent`) — the single, tested place where deltas are reconstructed into discrete message parts. Interleaved reasoning → text → tool-call → text folds into four distinct parts instead of collapsing.
- **CLI state** (`packages/cli/src/providers/chat.tsx`) — folds events into React state in real time, renders them as they arrive, and wires up cancel, new-session, and the approval round-trip.

## Server API

Mounted at `http://localhost:3001` (override with `API_URL` / `PORT`):

| Route | Method | Description |
| --- | --- | --- |
| `/health` | GET | Liveness check |
| `/providers` | GET | Which providers have API keys configured |
| `/chat` | POST | Streams one chat turn as SSE |

## Configuration & State

Everything is stored as flat JSON under `~/.codeyantram/`:

| File | Contents |
| --- | --- |
| `auth.json` | Provider API keys (`0600`), managed via `/connect` |
| `preferences.json` | Saved theme, model, and agent |

Tests run with `NODE_ENV=test`, which disables disk writes so test suites never touch real config.

## Development

### Root scripts

```bash
bun install             # install workspace deps
bun run dev:cli         # run the TUI (watch mode)
bun run dev:server      # run the local server (watch mode)
bun run test            # run every package's tests
bun run test:cli        # run just the CLI tests
bun run typecheck       # typecheck every package
```

### Per-package

```bash
cd packages/cli && bun dev          # or: bun run --watch src/index.tsx
cd packages/server && bun run dev   # or: bun --env-file=../../.env run --watch src/index.ts
```

### Testing

Each package has a `__tests__/` suite covering schemas, stream folding, models, tools, keyboard layer stack, commands, and more. Run from the root with `bun run test`, or per package.

## Project Structure

```
packages/
├── shared/src/
│   ├── agents.ts          # Agent catalog (Talk / Build) + tool-access rules
│   ├── models.ts          # Provider + model catalog, effort levels
│   ├── tools.ts           # Tool catalog + read-only classification
│   ├── schemas.ts         # Zod schemas: requests, messages, stream events
│   ├── stream.ts          # applyStreamEvent — delta → part folding
│   ├── auth.ts            # API key store (read/write/remove)
│   ├── local-store.ts     # ~/.codeyantram JSON read/write + test guard
│   └── routes.ts          # API route constants
├── server/src/
│   ├── index.ts           # Hono app, routes, port
│   ├── lib/chat-stream.ts # streamText → SSE bridge, tool loops, approval
│   ├── lib/models.ts      # model resolution + provider options
│   ├── providers/         # one builder per provider (AI SDK)
│   ├── routers/           # /chat and /providers Hono routers
│   └── tools/             # one executor per tool + path sandboxing
└── cli/src/
    ├── index.tsx          # entrypoint, renderer, screen switch
    ├── layouts/root.tsx   # provider composition
    ├── screens/           # Home (landing) ⇄ Session (transcript)
    ├── components/        # input bar, message list, overlays, toasts, pickers
    ├── providers/         # chat, theme, model, agent, overlay, toast, keyboard
    ├── api/chat.ts        # SSE client + schema validation
    ├── commands.tsx       # slash-command registry
    ├── keyboard.ts        # layered keyboard ownership stack
    ├── theme.ts           # 12 themes
    └── syntax-theme.ts    # tree-sitter style mapping
```

## Design Notes

- **Single path for success and failure** — the CLI consumes only parsed SSE events; a missing key, a network error, or a provider error all arrive as `error` events.
- **Shared contracts, single source of truth** — catalogs, schemas, and stream folding live in `shared` and are tested exactly once there.
- **Sandboxed by design** — every tool path resolves against `cwd` and rejects anything escaping the project root; mutating tools are gated behind user approval.
- **Keyboard ownership via a layer stack** — root, autocomplete, and overlay each claim the keyboard in turn, so only the topmost UI reacts to a keypress (and `ctrl+c` exits only when nothing else owns it).
