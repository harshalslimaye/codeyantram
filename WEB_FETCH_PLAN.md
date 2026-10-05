# Web Fetch Implementation Plan

Status: JEV key setup, the `/jev` usage toggle, and a reusable core evaluation adapter are implemented. Server-side runtime integration, web fetch, and relevance filtering remain proposed.

Build this feature in two milestones: a working web-fetch tool first, then optional JEV filtering. Keep the implementation inside `packages/core/src/tools/web-fetch/` and integrate it with the existing tool execution and chat streaming infrastructure.

The contracts, limits, module names, and thresholds below are proposed starting points. Confirm them during the relevant phase before implementing them.

## Phase 1 — Define the feature contract

1. Name the tool `web_fetch` and its implementation folder `web-fetch`.
2. Start with an OpenCode-style input:

   ```ts
   {
     url: string;
     format?: 'markdown' | 'text' | 'html';
     timeout?: number; // seconds
   }
   ```

   Markdown should be the default. OpenCode currently uses this input shape, a 30-second default timeout, a 120-second maximum, and a 5 MiB response limit. Use these as starting values. [OpenCode implementation](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/tool/webfetch.ts)

3. Support public HTTP and HTTPS URLs, including HTML, Markdown, plain text, JSON, and XML.
4. Define clear first-version boundaries: GET requests, no credentials or cookies, no JavaScript execution, and no binary attachments.
5. Define the result contract: requested URL, final URL, status, content type, returned format, content, and truncation information.
6. Leave caching, line paging, and browser rendering out of the initial milestone. Add these later if usage demonstrates a need.

**Completion condition:** The input, output, supported content, and limits are documented before implementation begins.

## Phase 2 — Establish module boundaries and shared execution

1. Organize the implementation by responsibility:

   ```text
   packages/core/src/tools/web-fetch/
     index.ts
     web-fetch.ts
     types.ts
     limits.ts
     url-policy.ts
     transport.ts
     response-body.ts
     content.ts
     output.ts
   ```

2. Put the AI SDK tool definition and input schema in `web-fetch.ts`. Keep network, conversion, and output logic in their respective modules.
3. Define small interfaces for the transport and, later, the relevance evaluator. Inject them so tests can run without external services.
4. Generalize the existing navigation executor into a shared tool executor. Preserve graph-specific error handling through a separate error mapper.
5. Share the existing per-turn execution budget across navigation and web tools. Creating a second executor must not accidentally double the budget.
6. Preserve the existing `ToolResult` envelope and serialized output limit. Add new error codes only where callers need to distinguish a specific failure.

**Completion condition:** Web fetch can use the existing execution infrastructure without changing graph behavior.

## Phase 3 — Implement URL policy and network transport

1. Validate URLs before opening a connection: accept HTTP/HTTPS, reject embedded credentials, and normalize the URL.
2. Implement the public-network policy for IPv4, IPv6, and DNS results, including loopback, private, link-local, and other non-public destinations.
3. Ensure the connection uses an address that passed validation. A DNS check followed by an independent lookup must not create a bypass.
4. Follow redirects explicitly, validate every destination, detect loops, and enforce a proposed five-hop limit.
5. Send predictable headers with a Codeyantram user agent and format-aware `Accept` preferences.
6. Combine caller cancellation with the request deadline. Cover DNS resolution, connection establishment, redirects, and body reading; release readers and sockets when cancelled.
7. Return useful errors for unreachable hosts, rejected destinations, authentication failures, rate limits, and other HTTP failures. Keep error-body excerpts short and treat them as untrusted content.

**Completion condition:** Requests and redirects obey the same policy, remain bounded, and stop promptly on cancellation.

## Phase 4 — Read and decode responses

1. Classify the response from its MIME type rather than assuming everything is HTML.
2. Reject unsupported declared content types before reading their bodies.
3. Read the response incrementally, enforcing the proposed 5 MiB cap on decompressed bytes. Reject oversized responses instead of silently returning an incomplete document.
4. Treat `Content-Length` as an early check, while enforcing the actual streaming limit independently.
5. Resolve text encoding using a valid declared charset, byte-order information, and an appropriate fallback. Account for supported encodings when detecting binary content.
6. Produce a transport result containing decoded text and response metadata. Keep HTML conversion outside this layer.

**Completion condition:** The fetch layer returns bounded, decoded content with accurate metadata, independent of output formatting.

## Phase 5 — Convert and shape content

1. Use Turndown for HTML-to-Markdown and `htmlparser2` for HTML-to-text, following the approach used by OpenCode. Verify the required versions and types before adding dependencies. [OpenCode conversion code](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/tool/webfetch.ts)
2. Preserve headings, lists, links, tables where supported, and fenced code blocks. Remove scripts, styles, and other non-content elements from converted output.
3. Resolve relative links against the final response URL.
4. Preserve already textual responses. Make it clear that requesting Markdown does not turn JSON or XML into an HTML-derived document.
5. Keep HTML mode explicit and bounded. Its content remains untrusted even when returned unchanged.
6. Build an output formatter that includes source metadata, untrusted-content framing, and explicit truncation notes. Neutralize forged boundary markers, while recognizing that markers alone do not prevent prompt injection.
7. Budget the complete serialized result—including metadata, warnings, and truncation notes—under the existing host limit. Use a smaller content allowance so normal responses have sufficient overhead space.

**Completion condition:** Each supported format produces readable output with clear source attribution and no hidden truncation.

## Phase 6 — Integrate the baseline tool into chat and CLI

1. Add the web-fetch capability to `ChatStreamOptions` independently of `workspaceGraph`.
2. Build the available tool set from the capabilities supplied by the host. Web fetch must work when the graph has not been initialized.
3. Register navigation and web tools with the same executor and existing provider-step limit.
4. Update agent instructions to explain when to fetch a URL, how to interpret truncation, and how to treat downloaded content as data.
5. Reuse existing tool-call/result streaming, conversation storage, replay, and compaction. Replace navigation-specific messages where they now describe general tool failures.
6. Show the URL in the CLI tool summary, with readable completion and error states.
7. Verify cancellation propagates from the CLI connection through the server to the web request.

**Completion condition:** An agent can fetch a URL and answer from its content through the normal Codeyantram conversation loop.

**Milestone 1:** The baseline web-fetch feature is usable without JEV.

## Phase 7 — Add optional JEV configuration

1. Add a separate JEV integration configuration containing its API key and an `enabled` preference. Keep it separate from the main chat-provider selection.
2. Default JEV usage to disabled. Saving a key must not enable it automatically.
3. Use the existing global user configuration and credential-storage conventions.
4. Use `/connect` with **TypeSafe (JEV)** for key setup and `/jev` to toggle usage. Keep JEV out of the coding-model catalog. The key lives at `providers.typesafe.apiKey`; the opt-in preference lives at `integrations.jev.enabled`. These configuration flows and the reusable core evaluation adapter are implemented; runtime integration remains to be built.
5. Load configuration through the host and inject only the required JEV options into core.
6. Define the following configuration and runtime behavior:

   | Configuration | Behavior |
   |---|---|
   | Disabled, with or without a key | Normal bounded web-fetch output |
   | Enabled with a configured key | Attempt JEV filtering |
   | Enabled without a key | Show a configuration error; continue with normal fetching |
   | JEV fails during a request | Return normal bounded content and report that filtering was skipped |

7. Keep keys out of tool arguments, conversation history, logs, and results. Disabling JEV should preserve the stored key.

**Completion condition:** JEV is used only when both the key and explicit enablement are present.

## Phase 8 — Create chunks and evaluate relevance

1. Add focused modules inside the same feature folder:

   ```text
   web-fetch/
     chunks.ts
     selection.ts
     jev/
       client.ts
       schemas.ts
   ```

2. Chunk converted Markdown or text by headings, paragraphs, lists, and code blocks. Split oversized sections at sensible boundaries and retain their heading context.
3. Give every chunk a stable identifier, source URL, section path, and position in the extracted document.
4. Supply a trusted relevance objective. Add an optional `query` argument for the fetch purpose and use the current user request as a fallback. Do not send the whole conversation or derive the objective from page instructions.
5. Use core's `createJevEvaluator` adapter, which provides typed evaluations, response validation, input limits, cancellation, and its own short deadline. Implement bounded batches and limited concurrency in the chunk-evaluation caller.
6. Start with an AI SDK Boolean question per chunk: whether it contains useful evidence for the stated task. The TypeSafe provider maps this to Noul and returns `.probability`. This is the probability of “yes”; it does not return a separate confidence field or measure the degree of relevance. [AI SDK TypeSafe provider](https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai), [TypeSafe Noul documentation](https://docs.typesafe.ai/primitives/noul)
7. Begin conservatively: discard only clearly irrelevant chunks, retain uncertain chunks, and preserve headings or adjacent context needed to understand selected evidence. Validate thresholds using real examples.
8. Leave small documents and explicitly requested raw HTML unfiltered. If no useful objective exists, skip filtering rather than guessing.

**Completion condition:** JEV returns chunk judgments; Codeyantram controls selection and preserves the original source text.

## Phase 9 — Connect filtering to output and recovery

1. Connect the full pipeline:

   ```text
   Fetch → Decode → Convert → Chunk → Optional JEV evaluation
         → Select → Bound output → Main LLM provider
   ```

2. Return selected chunks verbatim and in source order. JEV should classify content rather than rewrite or summarize it.
3. Include filtering metadata: whether filtering ran, how many chunks were evaluated and retained, and whether evaluation was incomplete.
4. Distinguish relevance filtering from output truncation. Content can survive filtering but still exceed the final response budget.
5. On partial or failed evaluation, retain unevaluated content and apply normal output limits. Avoid treating missing judgments as “irrelevant.”
6. Add a `filter: false` override so the agent can fetch unfiltered content when necessary. This override can disable filtering; it cannot enable JEV against the user’s configuration.
7. Keep JEV credentials restricted to its fixed API destination. Record its usage separately from the main provider’s usage.

**Completion condition:** Filtering is visible, recoverable, and never required for ordinary web fetching.

## Phase 10 — Validate, document, and release

1. Test URL validation, redirect policy, address validation, response limits, encodings, cancellation, conversion, and output budgeting with deterministic fixtures.
2. Test the baseline conversation flow across supported providers: registration, tool execution, replay, subsequent answers, and operation without an initialized graph.
3. Test every JEV configuration state and failure mode, including malformed answers, missing chunk judgments, timeouts, cancellation, and the unfiltered override.
4. Build a relevance evaluation set using documentation, API references, tutorials, pages containing code, irrelevant sections, and embedded instruction attempts.
5. Compare filtered and unfiltered runs for evidence retention, answer quality, provider input size, total cost, and added latency. Choose thresholds from those results rather than assuming filtering is beneficial.
6. Run `npm run typecheck` and the repository test suite. Use `npm test -- --maxWorkers=1` for the full suite where necessary to avoid the known CLI timing sensitivity. Run focused checks within earlier phases as their implementations land, rather than postponing all validation until this phase.
7. Document formats, limits, JEV setup, fallback behavior, and the fact that enabling JEV sends fetched chunks and the relevance objective to that service.
8. Commit in reviewable increments: baseline fetch, chat integration, JEV configuration, and JEV filtering.

**Completion condition:** The baseline feature works independently, JEV remains optional, and filtering has demonstrated acceptable evidence retention.

**Milestone 2:** Optional JEV filtering is integrated and evaluated.

## Recommended implementation order

Establish JEV configuration first, using the foundations in Phase 7. Complete the baseline web-fetch feature in Phases 1–6, then finish JEV runtime integration and filtering in Phases 7–10. Keep JEV disabled by default throughout rollout.
