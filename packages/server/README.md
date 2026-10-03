# Chat server

Run `npm run start:server` from the repository root, or
`npm start --workspace=@codeyantram/server`. The server binds to `127.0.0.1`
on port `43187`; `CODEYANTRAM_PORT` overrides the port. Stopping the process
closes active connections and cancels their model requests.

`@codeyantram/server` also exports `createApp()` without opening a listening
socket. Tests can supply `readConfig`, `streamChat`, and `compactChat` through its options.
The CLI uses `createApp()` to start its own server on a temporary localhost port
and closes it when the CLI exits. The standalone server is not required for CLI chat.

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
historical prefix. Each message must contain nonblank text. Assistant status
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

The CLI-owned server exposes an explicit `baseUrl` plus sibling `chatUrl` and
`compactUrl` endpoints. CLI `requestChat` and `requestCompact` share the SSE
reader, which validates events, ignores heartbeats, and reports an interruption
if the connection ends before a terminal event.

## Tests

Run `npm test -- --project server` from the repository root. HTTP tests bind
temporary localhost ports. Configuration and provider responses are simulated;
tests do not read the user's configuration or make live provider requests.
