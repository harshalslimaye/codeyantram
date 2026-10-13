# Trim older model-facing tool results

Priority: highest. The context projection, historical recovery, diagnostics,
CLI estimates, and provider regression coverage described below are implemented.
Conservative defaults are enabled for tool-capable agents, with core/HTTP opt-outs.
Live model quality, billing, cache effects, and latency comparisons remain unmeasured.
The phases below retain the original design and delivery rationale.

## Outcome

Retain every tool result in the full conversation transcript, SSE events, display, and Markdown export. Before each model request, replace eligible older result bodies with concise, explicitly incomplete records. Preserve the original calls, result IDs, tool names, order, execution status, and provider replay metadata.

The model should keep useful findings, exact paths and coordinates, coverage limitations, and errors without repeatedly receiving large source blocks or logs. It must have a working way to recover omitted historical output.

Success means smaller actual provider requests and comparable task quality after recovery costs are included. A summary displayed beside an unchanged provider payload does not count as trimming.

## Existing integration points

- `packages/cli/src/chat/context.ts`: `buildChatContext()` already clones the active transcript, applies the manual-compaction boundary, and closes interrupted tool calls with explicit cancellation results.
- `packages/cli/src/chat/session.ts`: `prepareChat()` builds requests from that context. The session retains complete messages independently. Context status and manual-compaction comparisons currently measure this untrimmed active context.
- `packages/shared/src/chat/schemas.ts`: replay validation requires unique call IDs and matching results within each assistant message.
- `packages/shared/src/tools/schemas.ts`: successful tool outputs allow JSON; error results have a separate strict envelope. Stored parts and SSE events share complete payloads.
- `packages/core/src/chat/messages.ts`: `toModelMessages()` converts request parts to SDK assistant/tool messages. Tool outputs currently contain the entire original result envelope.
- `packages/core/src/chat/stream-options.ts`: `createChatStream()` starts the model and uses `prepareStep` for execution-budget reminders. This is the integration point for trimming results generated within an ongoing turn.
- `packages/core/src/chat/provider-events.ts`: translates full executed results to SSE. Projection must not modify these events.
- `packages/ai-sdk-provider-chatgpt/src/index.ts`: serializes SDK tool results as function-call outputs. It needs wire-format regression coverage alongside OpenAI, Anthropic, and Google.

The installed SDK exposes `initialMessages` and accumulated `responseMessages` in `prepareStep`. Message overrides carry forward. Therefore, later projections must be built from complete initial and response messages, rather than repeatedly summarizing the previous projected messages. Verify this behavior with a multistep transport test before integrating it.

## Design decisions

### 1. Project at the provider boundary

Keep CLI-to-server `ChatRequest.messages` complete for the active context. Store no replacement summaries inside transcript parts. Apply trimming in core immediately before sending messages to a provider.

Introduce a pure shared policy and record builder, tentatively under `packages/shared/src/chat/tool-result-context.ts`, so CLI estimates and core projections use the same rules. It accepts tool-call/result candidates and age information without depending on the AI SDK. Core adapts `ModelMessage` arrays to those candidates and replaces only eligible result output values.

Keep the original outer tool-result envelope, including `toolCallId`, `toolName`, and `status`. Put the concise record inside the successful result's `output`. Leave error envelopes intact initially. No new transcript or SSE part type is needed.

The output is copy-on-write. Never mutate request messages, execution outputs, provider metadata, or shared references. Preserve assistant text, user text, reasoning items, call arguments, and all call/result positions. Large call arguments, including patch text, are outside this feature's scope and remain a measurable limitation.

### 2. Start with conservative, deterministic records

Use structured fields already returned by tools, plus bounded verbatim excerpts. Do not add a second model or JEV call to summarize results in the first version. Deterministic records are cheap, stable, and straightforward to audit, but cannot promise to capture every semantic finding in arbitrary source or logs.

Validate each supported output shape before building its record. Unknown tools, unexpected output shapes, and mandatory metadata that cannot fit safely retain their complete results. Preserve small results and exact errors. Keep patch outcomes complete initially because they are usually concise and contain useful applied-path/hash records.

| Tool group | Fields to retain in an older result record |
|---|---|
| `read` | Exact file path and content hash; requested/returned line ranges; total lines and next offset; bounded source excerpts; truncation, filtering coverage, and warnings. |
| `grep`, `glob` | Pattern and search root; returned match/path count; bounded exact paths, coordinates, and excerpts; coverage, incomplete/truncated flags, and filtering limitations. |
| Code graph | Query, coverage, freshness where supplied, bounded symbol references and coordinates, and reported relationships. Support each graph output shape explicitly. |
| Git tools | Original reported summary where supplied; bounded verbatim entries; coverage, incomplete/truncated flags, filtering limitations, and warnings. |
| `bash` | Workdir, exit code, signal, termination reason, truncation, warnings, and bounded stdout/stderr excerpts. The paired call retains the exact command. |
| `web_fetch` | Requested/final URL, HTTP status, format, bounded content excerpts, filtering and truncation information, and warnings. |
| Error results | Complete error code and message, including cancellation, uncertainty about side effects, and recovery instructions. |

For commands, execution `status: success` means the host ran the tool; a nonzero exit code, timeout, signal, or output limit remains visible. Do not infer that a test suite passed from a zero exit code alone or invent test counts. Preserve explicit reported test outcomes only when a recognized format can be extracted reliably; otherwise label excerpts as excerpts and provide recovery.

Every record includes a version, an explicit older-result marker, original serialized size, omission indication, and a recovery reference. Distinguish omissions introduced here from omissions/truncation/filtering already present in the original tool output. Historical reads describe a past snapshot; retaining a hash must not imply the current file still matches it.

Records remain untrusted tool data. Do not place extracted content into system instructions. Ordering and IDs remain exactly as before; keep Gemini thought signatures and other opaque replay options unchanged.

### 3. Define age and size explicitly

Use these as initial evaluation defaults, not measured optimal values:

- Cross-turn projection: protect the most recent two user-led turns, including the current user turn. Older completed tool results become candidates.
- Within-turn projection, added after cross-turn validation: protect results from the latest two tool-producing provider steps. Deliver every new result in full to the next model step at least once. Preserve each parallel batch under the same age rule.
- Consider only original serialized result envelopes of at least 8 KiB.
- Target a replacement envelope of at most 2 KiB and require at least 50% reduction for that individual result.
- Mandatory status, coverage, warnings, and reference fields take precedence over optional excerpts. If they cannot fit, retain the full result.
- Trim eligible candidates in a stable order. Do not force a hard total-context limit by deleting mandatory evidence or shrinking protected results.

Eligibility must use original history and original byte sizes. Repeated projection with the same history, policy, and step position produces the same output. Disable trimming when historical recovery cannot be offered under the agent's capabilities.

### 4. Provide exact historical recovery before enabling omission

Add a narrowly scoped read-only tool, tentatively `tool_result_read`, with a call ID, character offset, and bounded requested length. It retrieves the exact serialized original result envelope, including its original output, from an archive scoped to the current chat request.

Build this archive from complete active request history and complete live execution results. Never accept a workspace path or another session identifier. Resolve only results actually available in this request; reject missing IDs and invalid ranges clearly. Include snapshot hash, offset, next offset, and source-truncation information in recovery output. A returned page contains exact historical JSON text, not freshly fetched or reread content.

Use an 8 KiB default page target and a 24 KiB serialized response ceiling, adjusted downward for JSON escaping and mandatory metadata. Character offsets must not split Unicode surrogate pairs. Large outputs can be recovered through subsequent pages. Cancellation follows the existing tool executor.

Recovery counts against the existing tool-execution and provider-step budgets. Tell the model how to use it and when the remaining budget makes recovery unavailable. Protect recovered pages from immediate trimming so the next model step can use them. Never execute the original tool again merely to retrieve history, especially `bash` or `apply_patch`.

Make recovery a context capability enabled only for agents permitted to use tools; resolve its relationship with the catalog, agent validation, and existing explicit tool allowlists in the first implementation step. It grants access only to supplied conversation data, with no workspace or network capability. If that capability is unavailable, keep full results.

Previously compacted-away messages are absent from the active request and cannot be served by this archive. Do not advertise references to them. Session-wide retrieval across manual compaction would require a separate storage/API design and is outside the initial scope.

### 5. Keep manual compaction and estimates consistent

Manual compaction continues to summarize complete historical messages through its existing request, not these concise records. It retains its boundary semantics, cancellation behavior, and 20% reduction guard.

Expose both raw active-context bytes and projected model-context estimates. Use the shared policy for the CLI estimate without changing the messages sent to the server. Label estimates clearly: tool definitions, system instructions, provider serialization, and tokenization can differ.

Where manual-compaction eligibility and reduction comparisons are presented as model-context savings, compare projected before/after context under the same policy. Keep the existing raw-prefix reduction guard and report its meaning separately. This avoids claiming a large additional saving for a prefix already mostly trimmed.

Collect metadata-only diagnostics: eligible/trimmed counts, original/projected bytes, skipped reasons, recovery calls/bytes, projection time, and available provider usage. Do not include raw excerpts or logs in diagnostics. Track cached input separately; lower total input does not guarantee lower cost or latency because replacing history can affect prompt-cache reuse.

## Delivery sequence

| Phase | Work | Completion evidence |
|---|---|---|
| 1. Baseline and contract | Create representative fixtures, confirm SDK replay behavior, define record/recovery schemas and agent capability rules, add an internal policy switch defaulting off. | Captured baseline provider bodies and complete SSE/transcript/export fixtures; scope of retrieval is explicit. |
| 2. Recovery and projection | Implement request-scoped historical archive and recovery, pure policy, and validated record builders. Start with `read`, `grep`, `glob`, `web_fetch`, and `bash`; keep unsupported outputs full. | Exact paged recovery works; projected results retain IDs, status, coverage, and errors; original objects remain unchanged. |
| 3. Cross-turn integration | Apply core projection to older history for every chat request, including agents with no ordinary host tools when recovery is permitted. Connect shared estimation and diagnostics. | Provider bodies contain records instead of older large result bodies; SSE, transcript, and export still contain complete originals. |
| 4. Within-turn integration | Extend `prepareStep` using complete initial/response history; merge with existing budget reminders; support graph/Git records as their shapes are verified. | New results reach the model in full, older eligible results shrink later, provider metadata survives, and recovery pages remain usable. |
| 5. Evaluation and rollout | Compare baseline/projection tasks, tune age/size defaults, document behavior, and enable only after quality gates pass. Retain a disable switch. | End-to-end savings survive recovery and cache effects, with no regressions in the required fixture cases. |

The first usable release includes recovery and cross-turn trimming. Within-turn trimming follows as a separate reviewable change because SDK step history and budget handling add complexity.

## Verification

Add focused policy/record tests under `packages/shared/tests/chat/`, core projection/recovery tests under `packages/core/tests/chat/`, and extend CLI context/session/export tests. Extend server chat tests only where agent validation or options change.

Required cases:

- Threshold boundaries; recent-turn and recent-step protection; stable output; Unicode and escape-heavy logs; unknown/malformed output fallback; metadata exceeding the record budget.
- Deep-frozen originals remain unchanged. Full events and exported historical results contain exact originals after several sends and manual compaction.
- Each call still has exactly one corresponding result in its original position. Parallel calls, intervening assistant text, repeated tool names, cancelled calls, and failed turns replay correctly.
- Nonzero command exits, incomplete searches, filtered reads, output limits, stale graph references, and cancellation retain their uncertainty. Missing excerpts never become absence or success claims.
- OpenAI, Anthropic, Google, and ChatGPT adapter transport fixtures verify actual outgoing payloads, exact call IDs, and opaque provider metadata.
- A multistep fixture embeds unique markers in old source/log bodies: eligible markers disappear from later provider payloads while remaining in full emitted events and archives. Recent markers remain present.
- Recovery returns exact historical bytes/text across pages without executing tools again. Missing IDs, invalid ranges, exhausted budgets, cancellation, and compacted-away history have clear outcomes.
- Budget reminders, ten-step limit, twenty-execution limit, manual-compaction boundaries, and insufficient-reduction behavior remain correct.

For live evaluation, use identical source snapshots and model settings for baseline and trimming. Include follow-ups that need an old literal, exact historical logs after a file changes, interrupted tools, broad searches with limited coverage, test failures, and patch tasks that require recovery before editing.

Measure complete-task provider input/output, cache usage where reported, recovery volume, latency, and answer/patch correctness. Wire tests prove removal and preservation mechanics; they do not prove semantic quality. Require all critical fixtures to retain or successfully recover their necessary evidence. Record any live quality regressions before choosing rollout defaults.

Run focused tests, then `npm run typecheck`, `npm run lint`, and the existing full test suite for implementation changes. Creating this plan requires document review only.

## Acceptance criteria

1. Full active transcript, result events, and exports remain unchanged.
2. Eligible older result bodies are absent from actual model-facing payloads and replaced by concise records.
3. Call/result pairing, status, replay metadata, coverage, and actionable errors survive.
4. Omitted historical content can be recovered exactly within the active context without rerunning its original operation.
5. New/recent evidence and recovered pages reach the model intact.
6. Manual compaction and context estimates account for the projection consistently.
7. Benefits are measured across complete tasks, including recovery and provider cache effects.
