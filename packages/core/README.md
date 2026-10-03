# Core chat

`@codeyantram/core` exports `streamChat`, `resolveChatModel`, and `ChatError`.
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

Each consumed turn emits `start`, then text deltas, then `done` with duration
and available token usage, or `error`. Reasoning output is ignored by this
text-only contract. Requests are validated before calling a provider. Provider
errors use shared error codes and messages that omit raw request and response
details. Calls are attempted once, with no automatic retries.

Call `controller.abort()` to stop generation. Cancellation ends the stream
without `done` or `error`; retain any text already received. Stopping iteration
also aborts the provider request. A signal already aborted emits no events.

Effort is checked against the catalog. OpenAI receives `reasoningEffort`;
Anthropic receives adaptive thinking and `effort`; Gemini 3+ receives a named
thinking level. For Gemini 2.5, AI SDK 7 translates reasoning levels into token
budgets. Omitting effort preserves the provider's defaults.

`resolveChatModel` exposes the SDK model and call settings for callers needing
direct SDK access. It throws `ChatError` for unsupported models, unsupported
effort, or missing credentials. `streamChat` translates these into error events.

Run `npm test -- --project core` from the repository root. Tests use the actual
SDK with simulated HTTP responses and do not make live model requests.
