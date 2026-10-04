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

## Workspace navigation

Supply `workspaceGraph`, a host-bound `NavigationGraphService`, to `streamChat`
to enable `explore` and `graph`. Omitting it keeps chat without tool definitions.
`createNavigationTools(service)` also exports the same definitions for host use;
create a fresh set for each turn to reset the execution budget.

`explore` accepts a nonblank query of at most 1,024 characters, optional
`maxNodes` (1–20, default 12), and `maxCharacters` (2,048–24,000, default 12,000).
It uses the service's reconciliation barrier and returns context plus observation
freshness. `graph` takes an empty object and reads cached diagnostics, with at
most 20 pending paths and sanitized error messages. It does not open or index
the workspace. Arguments are strict; neither tool accepts a root or database.
There is no watcher; every explore reconciles manual saves before reading.

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
