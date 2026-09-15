# AGENTS.md

CodeYantram is a terminal AI assistant: a **Bun workspace monorepo** (`packages/*`) of four packages — `cli` (OpenTUI/React TUI), `server` (Hono, model routing + tool execution), `shared` (Zod schemas, catalogs, pure logic), `sessions` (SQLite-backed chat session store, via `@libsql/client`). The CLI never calls a model itself — it POSTs to the local server, which streams SSE events back. The server also owns the session store: every message is autosaved as it happens (not just at the end of a turn), so `/sessions` can list and resume past conversations across restarts.

## Build / test / typecheck (no lint or format tooling exists)

Run everything from the repo root with Bun (`bun`, not npm/yarn). Requires Bun >= 1.3.

```bash
bun install          # install workspace deps
bun run test         # run every package's tests  (bun test)
bun run typecheck    # typecheck every package     (tsc --noEmit)
bun run test:cli     # just the CLI suite
```

Per package: `cd packages/<pkg> && bun test` / `bun run typecheck`. There is **no build step and no CI** — tests and typecheck are the whole verification story.

`bun test` runs across each package's `__tests__/` suites (CLI mounts `-F '@codeyantram/cli' test`; per-package has finer granularity).

## Testing quirk — the config-write guard

`bun test` sets `NODE_ENV=test`, which disables real disk writes (`packages/shared/src/local-store.ts` `isTestEnv()`), so suites never touch `~/.codeyantram`. Don't "fix" suites by clearing that guard.

The one thing allowed to defeat it: setting `CODEYANTRAM_CONFIG_DIR` to a test's own temp directory turns real I/O back on (`isRealIoEnabled()`) - `sessions`' own store/db tests, and the server's session-router and prune-on-start tests, need this to exercise a real (isolated) SQLite database rather than a guaranteed no-op. Always pair it with `resetDbForTests()` (from `@codeyantram/sessions`) in `beforeEach`/`afterEach` - `getDb()` memoizes one client at module scope, so a stale one from a previous test would otherwise leak across tests, and across test files (Bun shares one process per `bun test` run).

## Run (manual smoke test — requires two terminals)

```bash
bun run dev:server   # Terminal 1 — Hono server on :3001 (reads API keys from env)
bun run dev:cli      # Terminal 2 — the TUI
```

The `server` package hardcodes `--env-file=../../.env` in its `dev` and `test` scripts, so it expects `.env` at the repo root (copy from `.env.example`). The `cli` dev script doesn't load `.env` — the CLI talks to the server over HTTP, and real provider keys must already be configured (`.env` on the server side or `~/.codeyantram/auth.json` via `/connect`).

## Where things live (entrypoints + contracts)

- `packages/cli/src/index.tsx` — CLI entry; `packages/server/src/index.ts` — Hono app entry.
- **Cross-package imports use workspace source directly** (`@codeyantram/shared`, `@codeyantram/server` resolve to their `src/` via `module`), not built artifacts — no `dist`/build output exists. Editing `shared` changes behavior for the other two with no build step.
- Everything that crosses the CLI/server boundary — message shapes, tool/agent/model catalogs, stream-event folding (`applyStreamEvent`), API route constants — is defined **once** in `shared` and tested there (`packages/shared/src/{schemas,stream,tools,agents,models,routes}.ts`). Keep contracts in `shared`, not inlined per package.
- Tool definitions live in `shared/src/tools.ts`; tool *executors* and path sandboxing live in `packages/server/src/tools/`; `web_fetch`'s network policy is `server/src/tools/{url-policy,web-fetch}.ts`, and the `git` tool's read-only guarantee is its subcommand allowlist (`GIT_READ_ONLY_SUBCOMMANDS` in `shared`), not a per-command policy in the executor.
- **Sessions**: storage (schema, migrations, retention query) lives in `packages/sessions/src/store.ts`, opened via `getDb()`/`openDb()` in `db.ts` (SQLite `file:` URL, WAL mode, PRAGMA foreign_keys, `sessions.db`/`-wal`/`-shm` all hardened to `0600` on every open — see `hardenFilePermissions`). The wire contract (request/response schemas, distinct from the store's own row shapes) lives in `shared/src/schemas.ts`; the HTTP router is `server/src/routers/sessions.ts`; the CLI's client is `packages/cli/src/api/sessions.ts`. `packages/server/src/index.ts` runs a fire-and-forget prune sweep (keep newest 200 sessions per project, drop anything older than 90 days, then `VACUUM` if anything was actually deleted) once at startup — it must never block the server from accepting requests.
- **Session autosave** (`packages/cli/src/providers/session-autosave.ts`) serializes every save (create/append/resolve-approval) through one promise chain, not fired independently - a user message and the assistant reply that follows it are separate calls in quick succession, and without sequencing the second (an append) could race ahead of the first (a create) before a session id even exists to append to. Every save is fire-and-forget from `chat.tsx`'s side: a slow or failed save must never delay or break the live conversation. Don't add an `await` on these calls from `ChatProvider`.

## Conventions that differ from defaults

- **TS/typecheck**: `tsconfig.json` has `allowImportingTsExtensions` on and `noEmit`, and `module: Preserve`. Imports are written **with `.ts`/`.tsx` extensions** where appropriate and are not stripped — no bundler runs in front of Bun.
- **Indentation is not uniform**: `shared` uses 4-space; the CLI uses 2-space. Match the file you're editing; don't reformat the other style.
- **Server reads env for keys**; the CLI does not. `.env` is gitignored.

## Design invariants worth not breaking

- **Single code path for success and failure** — the server delivers errors (including a missing API key) as `error` SSE events, not HTTP error statuses; aborted connections (neither `done` nor `error`) are normal cancels. Don't introduce HTTP-error branches.
- **Mutating tools require user approval** — `edit_file`/`write_file`/`bash` (Build agent) and `web_fetch` (Talk and Build, it leaves the machine). Read-only tools run unprompted, `git` included: it skips the approval gate only because no subcommand on its allowlist can write in any mode. `branch`, `tag`, `stash`, `remote`, and `reflog` are off that list for exactly that reason — each hangs a writing form off the name it lists under (`git stash` alone pushes a stash) — so don't add a subcommand there without checking every mode and option it accepts. Tool loops are capped at 15 steps. Don't loosen these.
- **Yolo is the one deliberate exception to the rule above, not a bug in it.** The Yolo agent gets Build's full tool catalog but skips the approval gate entirely, `web_fetch` included — enforced in exactly one place, `buildProjectTools`'s `skipApproval` parameter (`server/src/tools/index.ts`), which forces every tool's `needsApproval` to `false` regardless of `toolNeedsApproval`; wired from `chat-stream.ts` via `agentBypassesApproval(request.agent)` (`shared/src/agents.ts`). If you touch approval logic, that's the only place agent name should ever override a tool's own `needsApproval` — don't add a second one.
- **Sandboxed by design** — every tool path resolves against the project root (`cwd`) and must not escape it.
- Hono app routes are **chained into one expression** in `server/src/index.ts` so `typeof app` carries every route's type for the RPC client — add routes by extending the chain, not with separate `app.get(...)` statements.
