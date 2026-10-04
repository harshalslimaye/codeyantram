# Chat server

Run `npm run start:server` from the repository root, or
`npm start --workspace=@codeyantram/server`. The server binds to `127.0.0.1`
on port `43187`; `CODEYANTRAM_PORT` overrides the port. Stopping the process
closes active connections, cancels their model requests, and drains graph work
before releasing its workspace lease. The standalone workspace is the npm
invocation directory (`INIT_CWD`), or the process directory on direct launches.

`@codeyantram/server` also exports `createApp()` without opening a listening
socket. Tests can supply `readConfig`, `streamChat`, and `compactChat` through its options.
The CLI uses `createApp()` to start its own server on a temporary localhost port
and closes it when the CLI exits. The standalone server is not required for CLI chat.

## Workspace graph lifetime

Pass the host-selected `workspaceRoot` to `createApp()`. The returned Express
application has `workspaceGraph`, a `WorkspaceGraphService`, and an asynchronous
`close()` for application resources. A host that manages its own HTTP server
must close both it and the application; `createServerShutdown(server, () =>
app.close())` provides an idempotent combined shutdown function. The CLI and
standalone entry point both use it, including startup-error cleanup.

The service acquires a coordinator lease on the first `initialize()`, `query()`,
or `edit()` call. Concurrent requests share that acquisition and the workspace
operation queue. Opening the app, reading service status, and ordinary chat do
not open SQLite or trigger indexing. Chat opens the graph only when the model
calls `explore`; diagnostic `graph` reads cached status. A failed acquisition can be retried.
The service retains its lease after each operation; cancellation does not
release it. Startup catch-up occurs on first graph use, when initialization
builds a missing/incomplete/outdated baseline or reconciliation scans an
existing graph before navigation.

Palette `/init` uses the CLI server's bound service directly in the same process,
with progress and cancellation callbacks. It creates no additional HTTP endpoint
and makes no provider request. The standalone `npm run cli -- init` command
continues to own and release its own lease without starting a server.

Shutdown rejects new graph work and aborts server-owned operations, waits for
acquisition and in-flight operations to settle, and releases the server's lease.
Edit reconciliation uses the coordinator's independent cleanup signal and
finishes before that release. Servers sharing a canonical root in one process
share a coordinator; closing one server releases only its own lease. Separate
processes retain their own queues and use the SDK's database write locks.
There is no watcher yet; manual edits are reconciled before queries.

## POST /chat

Send `Content-Type: application/json` and a shared `ChatRequest`:

```json
{
  "model": "gpt-6.1-sol",
  "effort": "high",
  "messages": [
    {"id": "user-1", "role": "user", "parts": [{"type": "text", "text": "Hello"}]}
  ]
}
```

Include previous user and assistant messages in `messages` for a continuing
conversation. Effort is optional and must be supported by the selected model.
Assistant parts may include complete `tool-call`/`tool-result` pairs; user parts
are text-only. Duplicate IDs, mismatched results, and unresolved calls are rejected.
The host-selected root enables core's `explore`/`graph` loop. Clients cannot
select graph roots or storage through requests. There is no tool HTTP endpoint.
The request body limit is 4 MB.
An optional `contextSummary` supplies compacted historical context; core replays
it as a labeled user message before `messages`.

The selected model's provider key is loaded from the shared user configuration
on every valid request, using the same `providers.<provider>.apiKey` field written
by the CLI's `/connect` command. Clients do not submit credentials in the request.
The configuration file is read in full, but only the selected provider's key is
passed to core. Environment keys are not loaded.

Valid requests return HTTP 200 with `Content-Type: text/event-stream`. Each
SSE data frame contains one shared `ChatStreamEvent`:

```text
data: {"type":"start","messageId":"assistant-1"}

data: {"type":"text-delta","text":"Hello back"}

data: {"type":"done","durationMs":20,"usage":{"inputTokens":10,"outputTokens":3}}

```

Core failures, including missing credentials and provider errors, are sent as
an `error` event and end the stream. A `done` event also ends the stream.
Navigation calls and results use `{type: 'tool-call', call}` and
`{type: 'tool-result', result}` events between text deltas. Tool errors are results
the model can act on; exhaustion of the six-step loop ends with `tool_limit`.
SSE comments (`: keep-alive`) are sent every 15 seconds while waiting; clients
should ignore comments. Writes wait for the socket to drain when necessary.
Disconnecting the client aborts core generation and stops the heartbeat.

Errors before streaming return a shared error event as a JSON body:

| HTTP status | Code | Cause |
| --- | --- | --- |
| 400 | `invalid_request` | Invalid chat input, malformed JSON, or invalid compressed body |
| 413 | `invalid_request` | Body exceeds 4 MB |
| 415 | `invalid_request` | Unsupported body charset or content encoding |
| 500 | `internal_error` | Configuration or another server failure |

Errors after streaming starts use SSE with HTTP 200. Internal error messages
omit configuration contents, credentials, and raw provider details.

## POST /compact

Send a shared `CompactRequest` as JSON:

```json
{
  "model": "gpt-6.1-sol",
  "previousSummary": "Earlier objective and decisions.",
  "messages": [
    {"id": "user-1", "role": "user", "parts": [{"type": "text", "text": "Update /src/chat.ts."}]},
    {"id": "assistant-1", "role": "assistant", "status": "cancelled", "parts": [{"type": "text", "text": "Partial work."}]}
  ]
}
```

`previousSummary` is optional; `messages` contains only the newly selected
historical prefix. Each message must contain nonblank text or assistant tool parts. Assistant status
can be `complete`, `cancelled`, or `failed` and is optional. Status is rejected
on user messages. Summary strings must be nonblank and at most 12,000 characters.
The endpoint shares `/chat`'s 4 MB body limit, per-request selected-provider
credential loading, JSON validation errors, and SSE heartbeat/backpressure.

The stream emits `start`, then a complete `done` or an `error`. Summary text
is not streamed in deltas:

```text
data: {"type":"start"}

data: {"type":"done","summary":"Objective: update /src/chat.ts. Validation pending.","durationMs":20,"usage":{"inputTokens":10,"outputTokens":3}}

```

Core reports `compaction_failed` for an unusable or truncated result, and the
usual categories for credential/provider failures. Disconnecting or closing
the server aborts the operation and immediately stops its heartbeat. The server
does not retain session state or replace conversation context.

After accepting the summary, a client sends it as `contextSummary` on `/chat`
alongside the retained tail and the next user message. Omit the archived prefix
from `messages`; sending it again defeats the context reduction. For example:

```json
{
  "model": "gpt-6.1-sol",
  "contextSummary": "Objective: update /src/chat.ts. Validation pending.",
  "messages": [
    {"id": "recent-user", "role": "user", "parts": [{"type": "text", "text": "Keep the API compatible."}]},
    {"id": "recent-assistant", "role": "assistant", "parts": [{"type": "text", "text": "Compatibility review is pending."}]},
    {"id": "next-user", "role": "user", "parts": [{"type": "text", "text": "Continue the review."}]}
  ]
}
```

Retain the full display transcript locally. The server enforces the wire
contract and output validity; it does not enforce the CLI's two-turn retention,
minimum eligible size, or 20% byte-reduction policy. Clients must validate and
commit summary and boundary together and keep previous context on failure.
Compaction uses the selected model's supported low effort independently of
normal chat effort, so there is no `effort` field in `CompactRequest`.

The CLI-owned server exposes an explicit `baseUrl` plus sibling `chatUrl` and
`compactUrl` endpoints. CLI `requestChat` and `requestCompact` share the SSE
reader, which validates events, ignores heartbeats, and reports an interruption
if the connection ends before a terminal event.

## Tests

Run `npm test -- --project server` from the repository root. HTTP tests bind
temporary localhost ports. Configuration and provider responses are simulated;
tests do not read the user's configuration or make live provider requests.
