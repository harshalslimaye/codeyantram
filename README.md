# Codeyantram

A coding agent portfolio project organized as an npm workspace monorepo.

| Workspace | Intended role | Planned stack |
| --- | --- | --- |
| `packages/server` | HTTP server | Node.js, Express, TypeScript |
| `packages/cli` | Terminal interface | Node.js, Ink, React, TypeScript |
| `packages/core` | Model communication and agent logic | Vercel AI SDK, TypeScript |
| `packages/shared` | Shared contracts and application utilities | Zod, Node.js, TypeScript |

The root workspace holds shared TypeScript development tools. `core` owns model communication with OpenAI, Anthropic, and Google through the AI SDK. `shared` owns model catalogs, chat schemas, and application configuration utilities. The CLI starts a local server and sends chat requests to it; the server calls core. Core, server, and the CLI also use `shared`.

Direct dependencies use exact versions. If a package is used by more than one workspace, keep its declared version identical in each workspace. The root `package-lock.json` records the resolved dependency tree.

Requires Node.js 22.12+ on the 22.x line, 24.x, or 26+.

## Run the CLI

```sh
npm run cli
```

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
for a summary wrapper; they are not provider token counts or a context-fit
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
(`name` and `description`); per-tool argument schemas and executors will live
with the tool implementations. Tool names use letters, digits, and underscores,
start with a letter or underscore, and have a maximum length of 64 characters.

A `ToolCall` carries `toolCallId`, `toolName`, and a JSON object `input`.
A `ToolResult` repeats the ID and name, with either `status: 'success'` and
JSON `output`, or `status: 'error'` and a structured `{code, message}` error.
Inputs and outputs reject non-JSON values, including nested `undefined`,
non-finite numbers, functions, and bigint. Tool envelope fields are strict;
tool-specific input fields are preserved for validation by the implementation.
The schemas validate individual payloads; matching results to outstanding calls
and validating arguments against the selected tool belong to the execution layer.

Stored parts and stream events share the shapes `{type: 'tool-call', call}` and
`{type: 'tool-result', result}`. These contracts are exported separately from
the existing text-only chat schemas until tool execution, history replay, and
CLI rendering are integrated. No tool executors or agent loop are included yet.

## Tests

Vitest is configured at the repository root with named `cli`, `shared`, `core`,
and `server` projects.

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
