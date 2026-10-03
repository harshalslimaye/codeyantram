# Chat server

Run `npm run start:server` from the repository root, or
`npm start --workspace=@codeyantram/server`. The server binds to `127.0.0.1`
on port `43187`; `CODEYANTRAM_PORT` overrides the port. Stopping the process
closes active connections and cancels their model requests.

`@codeyantram/server` also exports `createApp()` without opening a listening
socket. Tests can supply `readConfig` and `streamChat` through its options.
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

## Tests

Run `npm test -- --project server` from the repository root. HTTP tests bind
temporary localhost ports. Configuration and provider responses are simulated;
tests do not read the user's configuration or make live provider requests.
