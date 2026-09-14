# CodeYantram

A terminal-based AI coding assistant. CodeYantram brings an LLM agent into your terminal — chat with the model, and let it read, search, edit, and execute against your project — all with full streaming, a built-in approval gate for anything that mutates, and a small local server that keeps the TUI and the model providers separated.

Built with **Bun**, **OpenTUI** (a React-based TUI renderer), **Hono**, and the **Vercel AI SDK**.

## Features

- **In-terminal chat UI** — OpenTUI/React interface with streaming markdown rendering, live deltas, a "Thinking…" spinner, and tool-call status (`running…`, `done`, `needs approval`, `denied`).
- **Multi-provider support** — Anthropic, OpenAI, Google, and DeepSeek from one catalog, each with its own API key.
- **Reasoning effort control** — models that support it expose per-model effort levels (`none` → `max`), validated before a request is ever sent.
- **Two agents with graduated tool access**:
  - **Talk** — read-only tools (`read_file`, `list_dir`, `glob`, `grep`, `git`) plus `web_fetch` to read a URL — the one Talk tool that still asks for approval, since it leaves the machine.
  - **Build** — the full tool catalog, including mutating tools (`edit_file`, `write_file`, `bash`).
- **Project instructions** — an `AGENTS.md` (or `CLAUDE.md`) at the project root is loaded into the system prompt on every turn, so the project's own conventions travel with each request.
- **Tool approval gate** — every mutating tool pauses mid-turn and asks for explicit approval (`y`/`n`) before it runs.
- **Streaming SSE protocol** — one wire format for success *and* failure; cancel is just closing the connection.
- **Persistent chat sessions** — every message is autosaved as it happens (not just at the end of a turn), so `/sessions` can list, resume, rename, or delete past conversations across restarts; `--continue`/`--resume <id>` pick one up straight from launch.
- **Local persistence** — API keys (`auth.json`, `0600`), preferences (`preferences.json`), per-project prompt history (`prompt-history.json`), and chat sessions (`sessions.db`, SQLite) under `~/.codeyantram/` (`0700`).
- **12 hand-tuned themes** and tree-sitter syntax highlighting across 17+ languages.
- **Slash-command menu** with autocomplete (`/new`, `/agents`, `/models`, `/connect`, `/sessions`, `/themes`, `/exit`, …).
- **Read-only git without the shell** — a dedicated `git` tool runs ten inspection subcommands as argv (no shell, no pipes), so reading history, diffs, and blame costs no approval prompt and works in Talk too. Branches and tags are *arguments* here (`diff main...HEAD`, `show v1.2.0:src/config.ts`), not subcommands; every git command that writes still goes through `bash`.
- **Sandboxed tool paths** — every tool path is resolved against the project root and can never escape it.
- **Single-flight turns** — one response in flight at a time; escape/ctrl+c cancels cleanly.

## Architecture

CodeYantram is a **Bun workspace monorepo** with four packages:

```
codeyantram/
├── packages/
│   ├── cli/       # The terminal UI (OpenTUI + React)
│   ├── server/    # Local Hono server: model routing, tool execution, session API
│   ├── shared/    # Zod schemas, catalogs, and pure logic shared by both
│   └── sessions/  # SQLite-backed chat session store (schema, migrations, retention)
```

The **CLI** never talks to a model directly. It POSTs a chat request to the local **server**, which resolves the provider/model/API key, streams the response back over **SSE**, and executes any tool calls against the project root. The **shared** package defines the contract between them — schemas, the model/tool/agent catalogs, and stream-folding logic — so both sides can't drift apart. The **server** also owns the **sessions** package's store: every message and tool-approval decision is saved as it happens, so a conversation survives quitting the CLI.

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

The server binds to `127.0.0.1` only (never `0.0.0.0`), and every route requires a local auth token the server mints on first start and the CLI reads back automatically — see [Local server auth](#local-server-auth) below. Running the CLI against a server on another machine (or a manually-copied config directory) needs that token to travel too; `API_URL` alone isn't enough.

## Usage

### Keybindings

| Key | Action |
| --- | --- |
| `enter` | Send message |
| `shift+enter` | Insert a newline in the input |
| `↑` / `↓` | Step back and forward through this run's submitted prompts (inside a multi-line prompt, only from its first/last line) |
| `tab` | Cycle agents (Talk ⇄ Build) |
| `escape` | Cancel an in-flight stream; otherwise clear the prompt |
| `ctrl+c` | Clear the prompt; quit when the prompt is empty |
| `↑` / `↓` / `enter` / `tab` / `escape` | Navigate menus and overlays (when one owns the keyboard) |

### Slash commands

Type `/` in the input bar for an autocompleting menu:

| Command | Description |
| --- | --- |
| `/new` | Start a new session (the old one is already saved — see [Sessions](#sessions)) |
| `/agents` | Switch agent (Talk / Build) |
| `/models` | Switch model |
| `/connect` | Connect a provider with an API key (or clear one) |
| `/init` | Generate or refine this project's `AGENTS.md` (switches to Build) |
| `/instructions` | Toggle project instructions on/off for the session |
| `/sessions` | Browse, resume, rename, or delete saved sessions |
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

### Project instructions

If the project root has an [`AGENTS.md`](https://agents.md) (or, as a fallback, a `CLAUDE.md`), CodeYantram appends it to the system prompt for both agents — conventions, build/test commands, things to avoid. Nothing to enable and no restart needed: the file is re-read on every turn, so an edit applies to your next message.

| Behaviour | Detail |
| --- | --- |
| Location | `AGENTS.md`, then `CLAUDE.md`, at the project root (the `cwd` the CLI was started in) — first match wins, never both |
| Size cap | 32 KB, cut at a line boundary with a note saying it was cut |
| Missing / empty / binary | Treated as "no instructions" — never an error |
| Symlinks | Followed only while they stay inside the project root |
| Precedence | Below your messages: it shapes *how* work is done, and cannot approve a tool call, widen an agent's tool access, or override what you ask for in the conversation |

The contents are framed by `--- BEGIN/END PROJECT INSTRUCTIONS ---` markers, and a file that tries to write those markers itself has them stripped — so a repository you didn't author can't close the block early and speak as the system prompt.

Don't have one yet? Run `/init` to generate one — it surveys the project (README, manifests, build/test/lint config, CI) and writes a concise `AGENTS.md`, or refines an existing one in place. It switches you to the Build agent (it needs `write_file`), and the write itself still goes through the normal approval prompt like any other Build edit. A toast confirms once it's actually finished — including after any approval prompts along the way, not just the first response.

**Visibility and the off-switch.** Below a reply that loaded the project's instruction file, the usual token-count line also shows its filename and size (e.g. `1.2k in · 340 out · AGENTS.md 2.0KB`, `(cut)` appended if it hit the 32 KB cap) — so the cost is legible per turn, not just inferred. If it got cut off, you also get a one-time warning toast the first turn that happens, rather than silent truncation. Run `/instructions` to toggle instructions off or back on for the rest of the session, without renaming or deleting any file — useful for an A/B comparison of the model's behavior with and without them. The toggle covers every source below uniformly; there's no persistent status-bar indicator for the global or nested sources specifically, only the per-turn line above for the project file.

**A user-level file.** `~/.codeyantram/AGENTS.md` (or `CLAUDE.md`) applies across every project — conventions you want everywhere without repeating them into each repo's own file. It's composed above the project file in the same block, and the project's file wins wherever the two disagree. Together they're capped at 48 KB combined (each still capped at 32 KB on its own) — if both are large enough to exceed that, the user-level file gives way for that turn rather than either being cut down further.

**Nested instructions.** A subdirectory's own `AGENTS.md`/`CLAUDE.md` — say, `packages/server/AGENTS.md` in a monorepo — isn't loaded up front. It's picked up lazily: the first time `read_file` opens a file under that subtree, every ancestor instruction file between it and the project root (whose own file is already covered above) is appended to that tool call's result, framed the same way and once per directory per turn. Nothing elsewhere in the tree costs anything until the agent actually reads something under it.

**Prompt caching (Anthropic only).** The system prompt is sent as two separate blocks — the static per-agent prompt, and the instructions block — each with its own Anthropic `cache_control` breakpoint, so editing `AGENTS.md` only invalidates the smaller, instructions-specific cache entry rather than the whole system prompt. In practice CodeYantram's own static prompt (~500 tokens) sits under Anthropic's 1024-token minimum-cacheable-length for Sonnet/Opus, so it doesn't yet get its own independent cache hit — the split still costs nothing when that's true, and pays off automatically once either block grows past the threshold. The combined prompt still caches and gets reused turn-to-turn whenever the instructions are unchanged, which is the common case. Non-Anthropic providers never see the cache marker.

### Themes

Twelve built-in themes (Sahyadri, Kaapi, Thirai, Konkan, Sanganak, Aranya, Gulabi, Bazaar, Shishir, Ladakh, Oviya, Kaadu), switchable via `/themes`. Theme, model, and agent preferences persist across restarts.

### Sessions

Every message and tool-approval decision is saved to `~/.codeyantram/sessions.db` as it happens — not just at the end of a turn — so a conversation survives quitting the CLI. The Session screen shows the current conversation's title (server-derived from your first message, e.g. `fix the socket handshake`) in a small header above the transcript.

**The `/sessions` picker:**

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move the selection |
| `enter` | Resume the highlighted session |
| `ctrl+r` | Rename it (enter submits, a blank or unchanged title cancels with no API call) |
| `ctrl+d` | Delete it immediately (no confirm step — it's a deliberate modifier chord) |
| `escape` | Close the picker |

Deleting the session you're currently in starts a new one automatically, the same as `/new` — otherwise the next message would fail against a session that no longer exists. Renaming the session you're currently in updates the Session screen's header immediately.

**Resuming at launch**, instead of through the picker:

```bash
bun run dev:cli --continue        # resume this project's most recently updated session
bun run dev:cli --resume <id>     # resume a specific session by id
```

Both fall back to starting fresh (with a toast explaining why) if there's nothing to resume — no previous session for `--continue`, or an unknown/deleted id for `--resume`.

**Retention.** `sessions.db` has no size cap of its own, but it doesn't grow forever either — see [Session storage and retention](#session-storage-and-retention) below.

**Prompt history** (what `↑`/`↓` step through in the input bar, separate from saved chat sessions) is also persisted, per project, in `prompt-history.json` — a fresh `bun run dev:cli` in the same directory picks up where you left off.

## Tools

Defined in `packages/shared/src/tools.ts` and executed by the server against the project root:

| Tool | Description | Access |
| --- | --- | --- |
| `read_file` | Read a file's contents | Read-only (Talk + Build) |
| `list_dir` | List a directory's entries | Read-only |
| `glob` | Find files matching a glob | Read-only |
| `grep` | Regex-search file contents | Read-only |
| `git` | Read the repository — `status`, `log`, `diff`, `show`, `blame`, `describe`, `shortlog`, `rev-parse`, `ls-files`, `show-ref` | Read-only (Talk + Build) |
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

Mounted at `http://127.0.0.1:3001` (override with `API_URL` / `PORT` — `PORT` doesn't change the bind address, only which local port it listens on):

| Route | Method | Description |
| --- | --- | --- |
| `/health` | GET | Liveness check |
| `/providers` | GET | Which providers have API keys configured |
| `/chat` | POST | Streams one chat turn as SSE |
| `/sessions` | GET | List sessions for a project (`?project=<cwd>`) |
| `/sessions` | POST | Create a session with its first message; returns `{ id, title }` |
| `/sessions/:id` | GET | Load a session, messages included |
| `/sessions/:id` | PATCH | Rename a session |
| `/sessions/:id` | DELETE | Delete a session |
| `/sessions/:id/messages` | POST | Append an already-finished message |
| `/sessions/:id/approvals` | POST | Resolve a pending tool-call approval |

### Local server auth

The server is bound to loopback only, but loopback isn't a private channel — any process already running on the machine can reach `127.0.0.1`, not just the CLI. Every route (health check included) requires a token, checked against `~/.codeyantram/server-token.json` (`0600`, like `auth.json`):

- The server mints one the first time it starts against a given config directory, and reuses it on every subsequent start — nothing to configure.
- The CLI reads the same file and sends it automatically on every request; there's no setting to connect the two by hand as long as both point at the same config directory (the default, or a shared `CODEYANTRAM_CONFIG_DIR`).
- A request without the right token gets refused: a plain `401` for `/health` and `/providers`, and — matching how every other `/chat`-time failure is delivered — a normal-looking SSE stream carrying a `start` then an `error` event, never a raw HTTP error status. The CLI's existing error handling covers it with no special case.
- Deleting `server-token.json` and restarting the server rotates it; the CLI picks up the new value on its very next request, no CLI restart required.

## Configuration & State

`~/.codeyantram/` (`0700`) holds everything CodeYantram persists — flat JSON files, plus a small SQLite database for chat sessions:

| File | Contents |
| --- | --- |
| `auth.json` | Provider API keys (`0600`), managed via `/connect` |
| `preferences.json` | Saved theme, model, and agent |
| `server-token.json` | Local server auth token (`0600`) — see [Local server auth](#local-server-auth) |
| `sessions.db` (+ `-wal`/`-shm`) | Chat session history (`0600` on all three files) — see below |
| `prompt-history.json` | Prompt history (what `↑`/`↓` step through in the input), keyed per project |

Tests run with `NODE_ENV=test`, which disables disk writes so test suites never touch real config.

### Session storage and retention

Every message and tool-approval decision is saved to `sessions.db` as it happens (not just at the end of a conversation), so `/sessions` can list and resume past conversations across restarts. It has no size cap of its own — check its size any time with `du -h ~/.codeyantram/sessions.db*` — but it doesn't grow unbounded either: on every server start, a background sweep prunes, per project, whatever falls outside **both** of two independent caps (a session survives only if it clears both):

| Cap | Default |
| --- | --- |
| Keep the N most recently updated sessions | 200 |
| Drop anything older than | 90 days |

A prune that actually deletes something runs `VACUUM` afterward to reclaim the freed space on disk. You can also delete a session directly from the `/sessions` picker with `ctrl+d`.

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
│   ├── schemas.ts         # Zod schemas: requests, messages, stream events, session API
│   ├── stream.ts          # applyStreamEvent — delta → part folding
│   ├── auth.ts            # API key store (read/write/remove)
│   ├── local-store.ts     # ~/.codeyantram JSON read/write + test guard
│   └── routes.ts          # API route constants
├── sessions/src/
│   ├── store.ts           # createSession/appendMessage/listSessions/pruneSessions/…
│   ├── db.ts              # SQLite client (WAL, foreign keys, file permissions)
│   ├── migrations.ts      # forward-only PRAGMA user_version migrations
│   └── title.ts           # deriveTitle — session title from the first message
├── server/src/
│   ├── index.ts           # Hono app, routes, port, startup prune sweep + shutdown
│   ├── lib/chat-stream.ts # streamText → SSE bridge, tool loops, approval
│   ├── lib/models.ts      # model resolution + provider options
│   ├── lib/system-prompt.ts        # per-agent prompts as cache-breakpointed system messages
│   ├── lib/project-instructions.ts # global/project/nested AGENTS.md discovery, caps, framing, sandboxing
│   ├── providers/         # one builder per provider (AI SDK)
│   ├── routers/           # /chat, /providers, and /sessions Hono routers
│   └── tools/             # one executor per tool + path sandboxing
└── cli/src/
    ├── index.tsx                    # entrypoint, renderer, screen switch, --continue/--resume
    ├── resume.ts                    # parses --continue/--resume from argv
    ├── layouts/root.tsx             # provider composition
    ├── screens/                     # Home (landing) ⇄ Session (transcript + title header)
    ├── components/                  # input bar, message list, overlays, toasts, pickers
    ├── components/session-picker.tsx    # /sessions: list, resume, rename, delete
    ├── components/resume-on-launch.tsx  # --continue/--resume's actual load-and-resume
    ├── providers/                   # chat, theme, model, agent, overlay, toast, keyboard, history
    ├── providers/session-autosave.ts    # save-as-you-go, serialized through one promise chain
    ├── api/chat.ts                  # SSE client + schema validation
    ├── api/sessions.ts              # session API client (create/list/load/rename/delete/…)
    ├── utils/prompt-history-store.ts    # per-project prompt history persistence
    ├── commands.tsx                 # slash-command registry
    ├── keyboard.ts                  # layered keyboard ownership stack
    ├── theme.ts                     # 12 themes
    └── syntax-theme.ts              # tree-sitter style mapping
```

## Design Notes

- **Single path for success and failure** — the CLI consumes only parsed SSE events; a missing key, a network error, or a provider error all arrive as `error` events.
- **Shared contracts, single source of truth** — catalogs, schemas, and stream folding live in `shared` and are tested exactly once there.
- **Project instructions are input, not authority** — every source (`~/.codeyantram/AGENTS.md`, the project root's, a subdirectory's own) is folded in with explicit limits (no approval bypass, no tool-access widening) and its framing markers neutralized, on the assumption the repo may not be one the user wrote.
- **Nested instructions ride on the tool that touches them, not the prompt** — a subdirectory's `AGENTS.md` costs nothing until `read_file` actually opens something under it, then attaches to that call's own result instead of growing the system prompt for the whole session.
- **Cache breakpoints follow content that actually varies together** — the static per-agent prompt and the instructions block are separate system messages precisely so an `AGENTS.md` edit invalidates only the smaller, variable one, not the whole prompt.
- **Sandboxed by design** — every tool path resolves against `cwd` and rejects anything escaping the project root; mutating tools are gated behind user approval.
- **Keyboard ownership via a layer stack** — root, autocomplete, and overlay each claim the keyboard in turn, so only the topmost UI reacts to a keypress (and `ctrl+c` exits only when nothing else owns it).
- **Saved as it happens, never in the way** — every autosave call is fire-and-forget and serialized through one promise chain; a slow or failed save is logged and (once per failure streak) surfaced as a toast, but can never delay or break the live conversation that already succeeded by the time it runs.
