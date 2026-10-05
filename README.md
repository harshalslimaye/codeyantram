# Codeyantram

A coding agent portfolio project organized as an npm workspace monorepo.

| Workspace | Intended role | Planned stack |
| --- | --- | --- |
| `packages/server` | HTTP server | Node.js, Express, TypeScript |
| `packages/cli` | Terminal interface | Node.js, Ink, React, TypeScript |
| `packages/core` | Model communication and agent logic | Vercel AI SDK, TypeScript |
| `packages/graph` | Workspace indexing and code navigation | CodeGraph, TypeScript |
| `packages/shared` | Shared contracts and application utilities | Zod, Node.js, TypeScript |

The root workspace holds shared TypeScript development tools. `core` owns model communication with OpenAI, Anthropic, and Google through the AI SDK. `shared` owns model catalogs, chat schemas, and application configuration utilities. The CLI starts a local server and sends chat requests to it; the server calls core. Core, server, and the CLI also use `shared`.

`graph` opens per-workspace CodeGraph indexes under the user's global Codeyantram
directory and provides indexing, sync, symbol/source queries, and cleanup.
Its coordinator shares a workspace operation queue, reconciles before queries,
and awaits synchronization after recorded edits. Both forms of `init` use it.
The server lazily acquires a workspace coordinator on first graph use and
retains its lease until shutdown. Palette `/init` uses this service; ordinary
chat without navigation opens no graph. Core's five navigation tools use the bound service. See
[packages/graph/README.md](packages/graph/README.md) for the package boundary.

Direct dependencies use exact versions. If a package is used by more than one workspace, keep its declared version identical in each workspace. The root `package-lock.json` records the resolved dependency tree.

Requires Node.js 22.12+ on the 22.x line, 24.x, or 26+.

## Run the CLI

```sh
npm run cli
```

Select another project with `npm run cli -- --project /path/to/codebase` (or
`npm start -- --project /path/to/codebase`). `--project=/path/to/codebase` is also
accepted. Relative paths use the directory where npm was invoked. Without the
flag, that invocation directory is selected; direct Node launches use their
current directory. The selected directory must exist and is canonicalized so
symlink aliases select the same workspace. Run `npm run cli -- --help` for usage.
The CLI passes this root to its server and uses it for the displayed Git branch.

Use `/init` in the command palette to build or refresh the active project's
graph while keeping the conversation. Progress and results appear in the CLI.
Prompt editing and other commands are disabled during initialization; Escape
cancels it and waits for graph cleanup before accepting another operation.
Initialization uses global SQLite storage and makes no provider request.

The same initializer is available directly from the terminal:

```sh
npm run cli -- init
npm run cli -- init --project /path/to/codebase
```

`init` prints indexing progress, graph counts, and the global database path.
It uses the same project-root selection as chat. New, incomplete, or outdated
indexes get full indexing; rerunning against a complete index incrementally
syncs source changes. It honors `.gitignore` and CodeGraph defaults, and creates
no project configuration. SQLite stays in the user's global Codeyantram folder.
Failures exit with code 1; Ctrl+C cancels indexing and closes the graph before
exiting with code 130. Run `init` again to recover an interrupted index.
This command runs independently of the chat server, terminal UI, and provider keys.

The CLI starts its own server on a temporary localhost port and closes it on
exit. Multiple CLI sessions can run at once; no separate server command is needed.

Use `/connect` to save a provider API key and `/model` to select a model and
effort. Type a message and press Enter to see the assistant's answer as it streams.
The default model is Google Gemma (`gemma-4-31b-it`); a saved model selection takes precedence.
Follow-up messages include the conversation history. Escape cancels generation
and keeps any partial answer; use the mouse wheel or trackpad over the chat area
to scroll through the conversation. The input and status bars stay at the bottom.
Use `/clear` to reset the conversation, `/help` to list commands, or `/exit` to quit.
Conversations stay in memory for the current CLI session.

Use `/connect` and select **TypeSafe (JEV)** to save its evaluation API key.
Use `/jev` to toggle JEV usage on or off; the command appears in the palette
and `/help`, reports the saved state, and requires a configured key before
enabling. Saving a key does not enable usage. The key is stored at
`providers.typesafe.apiKey`, and the opt-in preference at
`integrations.jev.enabled`, in the global user config. Disabling preserves the
key. JEV is an evaluation integration and does not appear in `/model`.
This currently configures the integration only; evaluation requests and
web-fetch filtering will be implemented separately.

Use `/status` to add a session snapshot to scrollback showing the active model,
estimated context tokens against its catalog window, a usage bar, and estimated
percentage remaining. The footer shows live estimated context usage. Status cards
are UI-only and are excluded from chat and compaction requests; `/clear` removes them.
Context estimates include the active messages and summary, exclude archived history
and the unsent draft, and do not reserve output tokens or guarantee that a request fits.

## Compact conversation context

Use `/compact` to summarize older conversation context with the active model.
Future requests send that summary, the latest two user-led turns, and new
messages. The full transcript stays available through mouse scrolling; the summary
does not appear as an assistant answer. `/model` can switch providers afterward
because the summary is plain text. `/clear` resets both transcript and summary.
The CLI uses a separate terminal screen and handles mouse scrolling within chat.
Exiting restores the original terminal screen. `/clear` also resets scroll position.

While compaction runs, prompt editing and pickers are disabled. Escape cancels
the operation and keeps the previous context. Success reports estimated context
tokens and available usage for the compaction call, and the status bar shows
`Context: compacted` with the number of recent turns currently sent verbatim.
Failures, interrupted connections, truncated results, and summaries that do not
reduce the replaced context enough leave the previous context intact.

The latest two turns are always retained. A conversation with fewer than three
turns, or a newly eligible older prefix below about 1,500 estimated tokens,
makes no summarization request. Repeating `/compact` merges the previous summary
with newly eligible history; it does not resummarize archived transcript entries.
An accepted summary must reduce the replaced serialized UTF-8 context by at
least 20%, including its wrapper. That check excludes the retained turns and
does not guarantee a 20% reduction of the whole request or measured input tokens.

Compaction makes a separate paid model call. Available input/output and cache
usage is reported separately from chat replies, including when a complete
summary is rejected for insufficient reduction. Missing usage stays unknown.
Token estimates use `ceil(UTF-8 text bytes / 4) + 6` per message, plus 32 tokens
for a summary wrapper. Tool parts count their serialized JSON bytes; these
estimates are not provider token counts or a context-fit
guarantee. Requests over 4 MB or estimated to exceed the selected model's window
are rejected before generation. Try compacting earlier or using a larger-context
model if the input is too large. Automatic compaction, session persistence, and
chunked summarization are outside the current feature.

## Run the chat server

```sh
npm run start:server
```

The server listens on `http://127.0.0.1:43187`. Set `CODEYANTRAM_PORT` to change
the port. `POST /chat` and `POST /compact` stream shared events over SSE using provider keys
saved by `/connect`. This standalone server is useful for other HTTP clients;
the CLI uses its own server and does not use `CODEYANTRAM_PORT`.
See [packages/server/README.md](packages/server/README.md) for the request and
response contract.

## CLI themes

Use `/theme` in the CLI to choose a built-in or custom theme. Theme files,
configuration paths, precedence, and the custom JSON format are documented in
[packages/cli/THEMES.md](packages/cli/THEMES.md).

## Tool contracts

`@codeyantram/shared` exports tool schemas and their inferred TypeScript types
from `packages/shared/src/tools`. Definitions currently describe metadata
(`name` and `description`); per-tool argument schemas and executors live
with the tool implementations. Tool names use letters, digits, and underscores,
start with a letter or underscore, and have a maximum length of 64 characters.

A `ToolCall` carries `toolCallId`, `toolName`, and a JSON object `input`, plus
optional opaque `providerOptions` required for replay by some providers.
A `ToolResult` repeats the ID and name, with either `status: 'success'` and
JSON `output`, or `status: 'error'` and a structured `{code, message}` error.
Inputs and outputs reject non-JSON values, including nested `undefined`,
non-finite numbers, functions, and bigint. Tool envelope fields are strict;
tool-specific input fields are preserved for validation by the implementation.
The schemas validate individual payloads; matching results to outstanding calls
and validating arguments against the selected tool belong to the execution layer.

Stored assistant parts and stream events share the shapes
`{type: 'tool-call', call}` and `{type: 'tool-result', result}`. User parts remain
text-only. Chat validates paired calls/results, replays them to the provider,
and preserves them in compaction. The CLI shows tool activity and completion
without dumping source results into scrollback. Interrupted calls are closed
for replay with an explicit unknown-outcome error.

`explore({query, maxNodes?, maxCharacters?})` returns relevant symbols,
relationships, and verified source snippets after synchronizing the selected
workspace. It lazily builds the initial index if necessary. `graph({})` reports
lifecycle, freshness, pending changes, and failures without opening SQLite.
Both tools are read-only; arguments cannot change the selected root or storage.
Navigation uses at most six provider steps and twelve executions per turn.
`find({query, limit?, maxCharacters?})` returns symbol candidates with verified
references. `inspect` accepts one reference to read source, or a relative
`filePath` for an indexed outline. `trace` follows callers or callees of a
reference, with bounded depth. References bind the workspace, symbol, path,
and file hash; changes to that file produce `stale_reference` and require
rediscovery. No-op scans and unrelated edits preserve them. The CLI displays
queries and file targets while retaining complete references for model replay.
Each tool has its own file in `packages/core/src/tools`. Mutation tools and
filesystem watchers remain next steps.

## Tests

Vitest is configured at the repository root with named `cli`, `shared`, `core`,
`graph`, and `server` projects.

```sh
npm test                             # Run all tests once
npm run test:watch                   # Watch and rerun affected tests
npm run test:coverage                # Print coverage and write coverage/index.html
npm test -- --project cli            # Run only CLI tests
npm test -- --project shared         # Run only shared tests
npm test -- --project core           # Run only core tests
npm test -- --project server         # Run only server tests
npm test -- packages/cli/tests/models/preferences.test.ts
npm run typecheck                    # Check source, tests, and Vitest configuration
```

The CLI workspace also supports `npm test --workspace=@codeyantram/cli`.

Each package has a `tests/` folder beside `src/`. Keep all tests in `tests/`,
mirroring the relative source paths: `src/theme/utils/colors.ts` is tested by
`tests/theme/utils/colors.test.ts`. Use `*.test.ts` or `*.test.tsx` and import test
APIs explicitly from `vitest`. Tests run in the Node environment.
Use temporary directories for filesystem tests and mock external boundaries;
tests must not use real API keys or the user's configuration. Mocks and stubbed
environment variables are restored between tests; clean up temporary files and
timers in teardown hooks.

Compaction regressions exercise a CLI session through its localhost server and
the actual SDK adapters with simulated OpenAI, Anthropic, and Google responses.
They cover smaller context, unchanged scrollback, provider switches, summary
refresh, rollback, and clear. These checks do not measure summary quality or
net cost savings. See the [compaction evaluation guide](packages/core/COMPACTION_EVALUATION.md)
for the representative fixture and a separate live-evaluation checklist.

Coverage uses V8 and includes untested source files across all workspaces.
Reports are informational while the suite grows; no coverage thresholds are
enforced yet. Generated coverage and Vitest artifacts are ignored by Git.
