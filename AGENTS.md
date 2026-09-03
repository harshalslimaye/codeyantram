# AGENTS.md

CodeYantram is a terminal AI assistant: a **Bun workspace monorepo** (`packages/*`) of three packages — `cli` (OpenTUI/React TUI), `server` (Hono, model routing + tool execution), `shared` (Zod schemas, catalogs, pure logic). The CLI never calls a model itself — it POSTs to the local server, which streams SSE events back.

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
- Tool definitions live in `shared/src/tools.ts`; tool *executors* and path sandboxing live in `packages/server/src/tools/`; `web_fetch`'s network policy is `server/src/tools/{url-policy,web-fetch}.ts`.

## Conventions that differ from defaults

- **TS/typecheck**: `tsconfig.json` has `allowImportingTsExtensions` on and `noEmit`, and `module: Preserve`. Imports are written **with `.ts`/`.tsx` extensions** where appropriate and are not stripped — no bundler runs in front of Bun.
- **Indentation is not uniform**: `shared` uses 4-space; the CLI uses 2-space. Match the file you're editing; don't reformat the other style.
- **Server reads env for keys**; the CLI does not. `.env` is gitignored.

## Design invariants worth not breaking

- **Single code path for success and failure** — the server delivers errors (including a missing API key) as `error` SSE events, not HTTP error statuses; aborted connections (neither `done` nor `error`) are normal cancels. Don't introduce HTTP-error branches.
- **Mutating tools require user approval** — `edit_file`/`write_file`/`bash` (Build agent) and `web_fetch` (both agents, it leaves the machine). Read-only tools run unprompted. Tool loops are capped at 15 steps. Don't loosen these.
- **Sandboxed by design** — every tool path resolves against the project root (`cwd`) and must not escape it.
- Hono app routes are **chained into one expression** in `server/src/index.ts` so `typeof app` carries every route's type for the RPC client — add routes by extending the chain, not with separate `app.get(...)` statements.
