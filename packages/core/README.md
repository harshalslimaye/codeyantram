# Core chat

`@codeyantram/core` exports `streamChat`, `compactChat`, `resolveChatModel`, and `ChatError`.
It supports the OpenAI, Anthropic, and Google models in the shared catalog.

```ts
import {streamChat} from '@codeyantram/core';

const controller = new AbortController();
for await (const event of streamChat(request, {
  credentials,
  abortSignal: controller.signal,
})) {
  // Forward the shared ChatStreamEvent to the client.
}
```

The caller supplies a shared `ChatRequest` and a credentials map, such as
`{openai: apiKey}`. Core does not read configuration files or environment API
keys. An optional `fetch` implementation can intercept provider requests.

Each consumed turn emits `start`, text deltas and any tool calls/results, then
`done` with duration and aggregate token usage, or `error`. Reasoning output is
not displayed. Requests are validated before calling a provider. Provider
errors use shared error codes and messages that omit raw request and response
details. Calls are attempted once, with no automatic retries.

Call `controller.abort()` to stop generation. Cancellation ends the stream
without `done` or `error`; retain any text already received. Stopping iteration
also aborts the provider request. A signal already aborted emits no events.

Effort is checked against the catalog. OpenAI receives `reasoningEffort`;
Anthropic receives adaptive thinking and `effort`; Gemini 3+ receives a named
thinking level. For Gemini 2.5, AI SDK 7 translates reasoning levels into token
budgets. Omitting effort preserves the provider's defaults.

Anthropic requests enable automatic prompt caching with top-level
`cache_control: {type: 'ephemeral'}` through the SDK's `cacheControl` option,
including models without effort controls. The provider advances the cache
breakpoint as history grows, using the default five-minute lifetime. Cache hits
depend on matching prefixes and the model's minimum cacheable length. Available
cache-read and cache-write counts are included in token usage. This applies to
both chat and compaction; replacing earlier context can reduce cache reuse.
See [Anthropic's prompt caching guide](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

An optional `ChatRequest.contextSummary` is replayed as a labeled user-level
historical-context message before the supplied conversation. It says current
user instructions may supersede the summary. It is not a trusted instruction
or an assistant reply. Requests without a summary retain their existing shape.

`compactChat(request, options)` accepts a shared `CompactRequest` containing
the model, an optional previous summary, and only the historical prefix to
replace. Options have the same credentials, abort signal, and injected fetch
fields as `streamChat`. The caller selects the prefix and retains recent turns;
core neither changes a transcript nor commits a summary.

```ts
import {compactChat} from '@codeyantram/core';

for await (const event of compactChat({
  model: 'gpt-6.1-sol',
  // previousSummary: existingSummary, // Include on a later compaction.
  messages: historicalPrefix,
}, {credentials, abortSignal: controller.signal})) {
  if (event.type === 'done') {
    // Validate replacement size and session ownership before committing.
    // Replay event.summary through ChatRequest.contextSummary afterward.
  }
}
```

Each historical message must contain nonblank text or assistant tool parts. Assistant messages may
carry `complete`, `cancelled`, or `failed` status; omitted status means complete.
The previous summary and messages are JSON source material in a user prompt,
separate from the summarization instructions. The instructions ask for objective,
constraints, exact literals, current decisions, reported validation, uncertainty,
and pending work. They distinguish partial responses and proposals from
completed work and user authorization.

Compaction emits `start`, then `done` with the validated summary, duration, and
available usage, or `error`. It uses a single non-streaming generation, supported
low effort (omitted on models without effort controls), a 4,096-token output cap,
and no retries. Blank summaries, output over 12,000 characters, and responses
that do not finish normally produce `compaction_failed`; partial summaries are
never emitted or repaired. Cancellation emits no terminal event, including when
a provider returns after abort. These policies are tested with HTTP fixtures;
live summary quality and cost savings have not been evaluated.

The caller owns retention boundaries, minimum eligible size, request-size
preflight, savings checks, usage accounting, and rollback. A `done` event means
the generated summary passed core's output checks; it does not prove factual
completeness, smaller context, or lower cost. The CLI applies those size and
lifecycle checks before replacing working context. Available usage on an
accepted core result is provider-reported; unavailable fields are omitted.
The [evaluation guide](COMPACTION_EVALUATION.md) separates automated transport
regressions from a live summary-quality assessment.

`resolveChatModel` exposes the SDK model and call settings for callers needing
direct SDK access. It throws `ChatError` for unsupported models, unsupported
effort, or missing credentials. `streamChat` translates these into error events.

Run `npm test -- --project core` from the repository root. Tests use the actual
SDK with simulated HTTP responses and do not make live model requests.

## JEV evaluation

`createJevEvaluator` provides TypeSafe evaluations through `@ai-sdk/typesafe-ai`
and the AI SDK's experimental evaluation API. JEV is separate from coding models
and does not participate in chat or compaction model resolution.

```ts
import {createJevEvaluator} from '@codeyantram/core';

// The host must check integrations.jev.enabled and load the TypeSafe key first.
const evaluator = createJevEvaluator({apiKey});
const result = await evaluator.evaluate({
  state: {task: 'Find the API signature', chunk: extractedContent},
  questions: {
    relevant: {
      type: 'boolean',
      instructions: 'Does the chunk contain evidence useful to the task?',
    },
  },
  abortSignal: controller.signal,
});
// result.answers.relevant.probability is P(true), not a graded relevance score.
```

The adapter supports Boolean, Choice, and Score questions with inferred answer
types. It defaults to `jev-latest`, accepts an explicit model ID for pinning,
and reports the resolved model ID. Results include duration, available token
usage, rounding precision, and any Choice/Score confidence. Missing usage stays
absent. Raw provider responses and credentials are not returned.

Shared relevance infrastructure lives in `src/evaluation`: `evaluateCandidates`
evaluates stable-ID candidates with caller-supplied state and questions, bounded
batching/concurrency, an overall deadline, validated Boolean probabilities, and
aggregated usage. Failed or missing judgments remain absent so callers can retain
uncertain evidence; caller cancellation propagates rather than returning a fallback.
Capability checks, objective normalization, status reporting, and cancellation
helpers are shared as well. Web-fetch keeps document chunking, relevance prompts,
structural retention, thresholds, and output assembly in its own tool folder.

Each batch accepts 1–64 questions and at most 1 MiB of serialized UTF-8 state
and questions. Choice questions support 1–255 options, and Score questions
support 2–10 levels. Input is validated and copied before sending. Core requires
an explicit nonblank key and does not fall back to an environment key. An injected
`fetch` supports host transport control and deterministic tests.

Calls use a five-second default deadline, configurable up to thirty seconds,
and zero retries. Cancellation and timeout stop waiting even if an injected
transport ignores the abort signal; such a transport remains responsible for
actually releasing its own resources. Late responses are never returned.
Failures throw `EvaluationError` with a stable code and sanitized message.
The SDK validates that answers match the requested IDs, types, ranges, and
probability distributions, respecting TypeSafe's declared rounding precision.

The adapter itself does not select chunks or read user configuration. The server
resolves opt-in once per chat turn and injects an evaluator into web fetch.
Calls use only the fixed `https://api.typesafe.ai/v1/systemone` destination and
reject redirects. Evaluation usage remains in web-fetch filtering metadata,
separate from chat usage.

## Web fetch

Supply a `webFetch: createWebFetchService({transport?, jev?})` capability to
`streamChat`. It works independently of `workspaceGraph`. The default server
always supplies web fetch. Both tool families share twelve executions and six
provider steps per turn, and keep the existing ToolResult/SSE/history contracts.

Input is `{url, format?: 'markdown' | 'text' | 'html', timeout?: number,
query?: string, filter?: boolean}`. URLs are at most 4,096 characters including
normalization, timeout is an integer in seconds (default 30, maximum 120), and
the optional relevance query is at most 2,048 characters. Without query, core
uses only the latest user text, capped at 2,048 characters. It never sends the
conversation or summary to JEV. `filter:false` overrides filtering only; it
cannot enable JEV against host configuration.

The native GET transport validates every resolved address and every redirect,
rejects non-public IPv4/IPv6 and transition ranges, and pins validated addresses
in socket lookup while preserving Host/SNI/TLS verification. It sends no cookies
or credentials, follows at most five redirects, detects loops, and caps both wire
and decompressed bytes at 5 MiB. Supported compression is gzip, deflate, and br.
Unsupported MIME types are rejected before body reading. Supported documents
are HTML/XHTML, Markdown, plain text, JSON, XML, and application +json/+xml.
Text decoding uses a valid declared charset, then BOM, then UTF-8. Binary data
is rejected. HTTP failures return sanitized status messages without error bodies.
Cancellation covers DNS, connection, redirects, and streaming bodies.

HTML conversion uses htmlparser2 and Turndown with GFM tables. Scripts, styles,
hidden elements, and embedded documents are removed; HTTP(S) links resolve
against the final URL. Conversion rejects over 50,000 elements or depth 128.
Explicit HTML skips conversion and filtering. Non-HTML text is preserved, with
an accurate returned format (JSON/XML remain text; Markdown remains Markdown).
JavaScript rendering, attachment downloads, cookies, caching, and paging are absent.

Enabled JEV filters converted documents of at least 6,000 characters. Stable
chunks have source URL, UTF-16 offsets, position, heading ancestry, and at most
2,400 characters. Documents requiring more than 4,096 chunks fall back to normal
bounded content before evaluation. Each Boolean answer is P(useful evidence), not confidence.
Up to the first 32 chunks are evaluated in batches of eight, with two concurrent
batches and a five-second overall filtering deadline in addition to the fetch
timeout. Only probabilities below 0.05 permit removal; this cutoff is provisional.
Uncertain, failed, and unevaluated chunks survive. Selection preserves heading
context, adjacent positive context, whole fenced examples, and source order.
Chunks are copied verbatim with explicit gap markers. All-negative selection
falls back to the original content. Small pages, missing objectives, disabled
JEV, and explicit HTML skip evaluation.

Results include requested/final URL, HTTP status, content type, returned format,
untrusted content framing, warnings, `filtering`, and `truncation`. Filtering has
status (`skipped`, `completed`, `partial`, `failed`), counts, incompleteness,
duration, and available JEV usage. Output truncation is independent of relevance
selection. Content is capped at 24,000 characters and the complete output at
60,000 UTF-8 JSON bytes, leaving room under the shared 80,000-byte envelope.
Forged boundary markers are escaped; framing is not a prompt-injection guarantee.
See [WEB_FETCH_EVALUATION.md](WEB_FETCH_EVALUATION.md) for validation and limitations.

## Workspace read

Supply `read: createReadService({workspaceRoot, jev?})` to `streamChat` to enable
the `read` tool independently of graph indexing. The server supplies it when a
host workspace root is configured, using the same host-resolved JEV opt-in as
web-fetch and navigation. Core never selects a root from model arguments.
`createReadTool(service, execute, objective?)` is also available to direct hosts;
share `createToolExecutor()` with other tools to enforce the per-turn budget.

Arguments are `filePath` (normalized workspace-relative path), optional 1-based
`offset`, `limit` (1–1,000; default 200), `maxCharacters` (1–24,000; default
24,000), relevance `query`, and `filter`. Read accepts regular UTF-8 text files
up to 1 MiB; directories, binary content, malformed UTF-8, and symlink escapes
are rejected. Canonical-path containment and descriptor identity checks precede
reading; detected concurrent changes fail rather than returning mixed source.
These checks are not an OS sandbox against a hostile process racing filesystem
mutations. Errors do not expose absolute host paths.

Output contains the relative path, a SHA-256 hash of the raw file snapshot,
total line count, original line-numbered `ranges`, and `nextOffset` for the
unfiltered page. CRLF line endings are normalized in ranges. Empty files and
offsets beyond EOF return no ranges. Character and JSON-byte budgets bound output;
`truncation` separately reports partial file coverage and shortened source lines.
A shortened line cannot be recovered by advancing to `nextOffset`; use a larger
`maxCharacters` where possible. Read does not support images or directory listing.

Host-enabled JEV evaluates pages of at least 6,000 characters when `query` or
the latest user objective is available. Only that objective, the relative path,
and the requested page's source ranges are sent to TypeSafe, not conversation
history or the rest of the file. This can send private repository content to an
external provider; hosts must honor the user's JEV preference.
Ranges use whole-line chunks of up to 40 lines, preferring 2,400 characters.
At most 32 chunks are evaluated, using the shared five-second deadline and
bounded batching. Missing judgments and unevaluated tails survive; leading
context and neighbors of positive evidence are also retained. All-negative or
failed evaluations return the original page. Filtering metadata reports counts,
status, completeness, duration, and available usage; omissions produce warnings.
Caller cancellation still cancels the tool.

Use `filter:false` for exact source inspection or before editing. Filtering never
renumbers lines or changes pagination, and is distinct from output truncation.
Filtered ranges may omit required declarations and are not a complete parseable
file. Source remains untrusted data even after JEV evaluation.

## Workspace grep

Supply `grep: createGrepService({workspaceRoot, jev?})` to `streamChat` for
workspace text search independent of graph indexing. The server supplies grep
for a configured host workspace and reuses the existing JEV opt-in/evaluator.
The default backend requires **ripgrep (`rg`) on the server's PATH**. No shell is
used and model arguments cannot select an executable, root, or arbitrary flags.
Direct hosts can use `createGrepTool(service, execute, objective?)` with the
shared per-turn executor; a trusted `GrepTransport` can be injected for testing.

Arguments are `pattern` (1–1,024 characters), optional workspace-relative `path`
(default `.`), ripgrep `include` glob, `fixedStrings`, `ignoreCase`, `limit`
(1–200; default 100), relevance `query`, and `filter`. Regex uses ripgrep's
default engine, not PCRE2 or multiline matching. Literal patterns and filenames
are passed as arguments, never shell commands. Results are ordered by path and
line before optional JEV ranking, with one result per matching line. `column`
and `textStartColumn` are 1-based UTF-8 byte offsets; `textTruncated` identifies
bounded source excerpts centered near the first match on a line.

Directory searches honor local ignore files and hidden-file defaults, including
`.gitignore` without requiring a Git repository. Explicit files may bypass those
defaults. Parent/global ignore files and ripgrep configuration are disabled.
Recursive search does not follow symlinks, and canonical explicit targets must
remain inside the host root. Files over 1 MiB are excluded; binary and undecodable
matches may be skipped. These checks are not an OS sandbox against hostile
concurrent filesystem mutations. Search is not a cross-file atomic snapshot;
use `read` with `filter:false` before editing.

Search has a ten-second deadline, an 8 MiB process-output budget, and a bounded
48,000-byte match payload. Reaching result/output limits stops the child and
reports `truncated` and `incomplete` plus warnings; unsupported match records
also mark incomplete results. Backend failures are sanitized tool errors rather
than claims of an empty search. Cancellation terminates the child process.
`coverage` explains exclusions, so empty results never prove absence.

Enabled JEV ranks up to 32 retrieved matches in bounded batches with a separate
five-second deadline. It uses `query` or the latest user objective, sending only
that objective, the pattern, and bounded match records to TypeSafe—not history
or entire files. Private source excerpts can reach an external provider; hosts
must honor the user's JEV preference. No matches are removed and original
locations/content remain unchanged. Unevaluated matches retain their original
slots; missing, failed, or all-negative judgments preserve evidence. `filter:false`
restores retrieval order. `filtering` reports ranking status, counts, completeness,
duration, and available usage independently of search truncation/coverage.

## Workspace navigation

Supply `workspaceGraph`, a host-bound `NavigationGraphService`, to `streamChat`
to enable `explore`, `graph`, `find`, `inspect`, and `trace`. Omitting graph,
web-fetch, read, and grep capabilities keeps chat without tool definitions.
`createNavigationTools(service)` also exports the same definitions for host use;
create a fresh set for each turn to reset the execution budget.

Pass an optional host-resolved `jev: JevCapability` to `streamChat` to evaluate
`explore` and `find` results. The server shares the existing JEV opt-in and
evaluator with web-fetch. Direct hosts can use
`createNavigationTools(service, execute, {jev, objective})`; the objective is the
latest user request, falling back to the tool query, never conversation history.
Enabled evaluation sends retrieved symbol metadata and, for explore, source
snippets and relationships to the TypeSafe provider. Repository content remains
untrusted data. Credentials and raw provider errors never enter tool results.

Both tools accept `filter:false` to bypass JEV. Results with fewer than two
candidates skip evaluation. Up to 32 candidates are evaluated in batches of eight,
with concurrency two and a five-second overall deadline. Results include
`filtering` metadata (mode, status, candidate counts, completeness, duration, and
available usage) and warnings. Evaluation failure returns normal graph results;
missing judgments are retained and caller cancellation still cancels the tool.

Explore removes only symbols with relevance probability below 0.05, retaining
whole snippets and all graph-connected context of surviving symbols. An all-negative
evaluation returns original context. When symbols are omitted, related files are
rebuilt and the original summary is cleared. Find only ranks evaluated candidates
within their original slots: no matches are dropped, unevaluated candidates stay
in place, and original graph scores and symbol references remain unchanged.
Freshness, coverage, and retrieval truncation are never rewritten by JEV;
evaluation cannot recover evidence that retrieval omitted. Inspect, trace, and
graph remain unevaluated.

Each tool owns its schema, description, and handler in a separate file:
`src/tools/codegraph/explore.ts`, `graph.ts`, `find.ts`, `inspect.ts`, and `trace.ts`. `src/tools/codegraph/index.ts` assembles
the tools with a shared per-turn executor from `execution.ts`; host-service
and executor interfaces live in `types.ts`.

`explore` accepts a nonblank query of at most 1,024 characters, optional
`maxNodes` (1–20, default 12), and `maxCharacters` (2,048–24,000, default 12,000).
It uses the service's reconciliation barrier and returns context plus observation
freshness. `graph` takes an empty object and reads cached diagnostics, with at
most 20 pending paths and sanitized error messages. It does not open or index
the workspace. Arguments are strict; neither tool accepts a root or database.
There is no watcher; every explore reconciles manual saves before reading.

`find` accepts `query`, optional `limit` (1–50, default 20), and the same
`maxCharacters` budget. It returns all retained candidates rather than resolving
ambiguous names automatically. Candidate symbols, explore symbols, and trace
symbols carry a `reference` with `workspaceId`, `symbolId`, `filePath`, and
`contentHash`. The shared `symbolReferenceSchema` validates this wire format.

`inspect` takes exactly one of `reference` or workspace-relative `filePath`.
A reference returns verified symbol metadata and sanitized SDK source; a path
returns an indexed file outline ordered by source location. Optional `limit`
bounds the outline (1–50, default 20); `maxCharacters` bounds either result.
Files outside indexed scope return `not_found`. Source over 1 MB returns
`source_too_large`; file paths cannot traverse outside the bound workspace.

`trace` takes a `reference`, `direction` (`callers` or `callees`), optional
`depth` (1–3, default 1), `limit` (1–50 related symbols, default 20), and
`maxCharacters`. It uses bounded SDK traversal over resolved calls and
instantiations and returns related symbols plus directed edges with available
line/column and metadata. Dynamic and unresolved calls may be absent; this
tool does not calculate a complete impact radius.

All three pass through the same reconciliation barrier. A reference remains
usable after no-op scans and unrelated file edits, including across observation
revisions. Edits, moves, or deletion of its own file, changed symbol IDs, and
foreign-workspace references return `stale_reference`. The model must rediscover;
tools never silently substitute a matching name. File hashes are rechecked around
reads, while external processes can still change the filesystem after a response.
Symbols expose `metadataTruncated`; context and source carry their own truncation
flags. These references are content checks, not an atomic filesystem snapshot.

The loop allows six provider steps and twelve executions per turn. Results have
an 80 KB serialized UTF-8 ceiling. A tool failure is a structured result the model
can inspect; hitting the step limit ends the turn with `tool_limit`, not `done`.
Cancellation reaches graph queries and ends without a terminal event. Source
and tool outputs are labeled untrusted data in navigation instructions.

Assistant history can interleave text, calls, and results. Replay converts them
to SDK assistant/tool roles and preserves opaque provider options such as Gemini
thought signatures. The CLI closes unresolved interrupted calls for replay
with an error describing the unknown outcome. Compaction receives tool parts
as historical JSON data and does not execute them. These behaviors are tested
with provider HTTP fixtures and the installed graph SDK; no live tool turn has
been evaluated by these tests.
