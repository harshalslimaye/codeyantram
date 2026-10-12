# Using JEV with read to reduce coding-model tokens

Date: 2026-10-12  
Status: Analysis and proposed plan. No runtime changes or live model evaluations have been made.

## Recommendation

Use JEV to select useful source spans, while Codeyantram preserves the surrounding structure and dependencies needed to interpret those spans. Return selected source verbatim, make omissions recoverable, and evaluate savings across complete tasks.

The first improvements should be better task context, better chunk boundaries, and selective dependency retention. Raising the relevance cutoff or reducing the output limit before fixing those inputs would increase the chance of losing important evidence.

The objective is to reduce the coding provider's input tokens while maintaining answer and patch quality. JEV consumes tokens itself, so coding-provider savings, total tokens across providers, monetary cost, and latency must be measured separately.

## 1. What the current implementation does

The current path is:

```text
Read a file snapshot
  → select the requested page
  → split the page into whole-line chunks
  → optionally evaluate chunks with JEV
  → retain relevant, uncertain, and neighboring chunks
  → return source ranges and metadata
  → replay the returned result in later coding-model requests
```

| Area | Current behavior | Implication |
|---|---|---|
| File snapshot | Reads a regular UTF-8 file up to 1 MiB and computes a full-file content hash. | Provides an identity for caching and detecting changed source. |
| Requested page | Defaults to 200 lines, with up to 24,000 source characters and a separate serialized page budget. | JEV only sees the page that survived retrieval limits. |
| Chunking | Whole-line chunks, targeting at most 40 lines and 2,400 characters. An individual oversized line can exceed the chunk target. | A function or control-flow branch can be split across chunks. |
| Eligibility | JEV must be available, filtering must not be disabled, an objective must exist, and page content must reach 6,000 characters. | Small or exact reads return the original page. |
| Objective | Explicit `read.query`, otherwise the latest user text, capped at 2,048 characters. | Short follow-ups can lose the meaning of the active task; a narrow query replaces the fallback objective. |
| Questions | One Boolean question per chunk about useful evidence. | Direct implementation, dependencies, and caveats are combined into one broad judgment. |
| Evaluation | At most 32 chunks, batches of eight, concurrency two, and a five-second shared deadline. | Missing judgments and unevaluated chunks are retained. |
| Selection | Only probabilities below 0.05 permit removal. The first chunk and neighbors of chunks scoring at least 0.5 are retained. | Conservative selection protects recall but can retain considerable unrelated source. |
| Fallback | If no chunks survive the initial judgments, or evaluation fails entirely, the original page is returned. | All-negative evaluations can incur JEV cost without saving coding-model tokens. |
| Editing | Tool instructions require `read` with `filter:false` before editing. | Filtering mainly helps discovery; a precise edit may still require an exact read. |
| Replay | The returned tool result is included in active conversation history. | Initial reductions can save tokens in multiple later calls, but retained or duplicated content also persists. |

Implementation references:

- [Read service](../../packages/core/src/tools/read/service.ts), particularly page selection and objective resolution.
- [Read limits](../../packages/core/src/tools/read/limits.ts).
- [Chunking](../../packages/core/src/tools/read/chunks.ts).
- [Selection and structural retention](../../packages/core/src/tools/read/selection.ts).
- [Shared evaluation batching](../../packages/core/src/evaluation/batches.ts).
- [Latest-user objective assembly](../../packages/core/src/chat/stream-options.ts).
- [Tool instructions](../../packages/core/src/tools/catalog.ts).
- [Model-message assembly](../../packages/core/src/chat/messages.ts).

The current [read selection tests](../../packages/core/tests/tools/read/selection.test.ts) validate mechanics with mocked judgments: retention, fallback, incomplete evaluation, deadlines, and cancellation. They do not establish live JEV accuracy or end-to-end token savings.

## 2. Why the current approach can waste tokens or lose context

### A short objective can filter against the wrong task

The latest user message might be “yes,” “also fix that,” or a correction to a previous request. Filtering against that text alone gives JEV little information about what the coding model is investigating. An explicit query such as “find the timeout” can also omit earlier requirements about cancellation or backward compatibility.

The result can be either excessive retention because the task is unclear, or removal of source that matters to an earlier requirement.

### Line chunks do not consistently preserve meaning

A chunk might contain a function body without its signature, a return statement without its condition, or a callback without the setup that determines its behavior. Keeping neighboring chunks after evaluation cannot correct a judgment made without that context.

JEV's documented limitations include difficulty with indirection and large states containing irrelevant detail. This supports giving it small, meaningful source units with explicit context rather than asking it to infer a codebase from disconnected fragments. [TypeSafe model limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

### Neighbor retention is coarse

Suppose the relevant code occupies a small function. Retaining its previous and next 40-line chunks may bring back two unrelated functions. Conversely, those neighbors may still fail to include an important declaration much earlier in the file.

Physical adjacency is a useful fallback, but source structure and verified dependencies are better guides when available.

### A relevance probability cannot prove completeness

The Boolean result means P(yes) for the particular question. It is not a measure of how much source is relevant, and a low probability does not certify that a range is safe to omit from every possible task. [TypeSafe Noul documentation](https://docs.typesafe.ai/primitives/noul).

Filtering must account for supporting declarations, exceptions, contradictory behavior, and unresolved dependencies. A task that asks for an exhaustive list or proof of absence needs a different reading policy from a task asking where a feature is implemented.

### Discovery followed by a full reread can erase savings

For a known, small function that will immediately be edited, running JEV and then making the required exact read may add cost and latency with little benefit. The strongest use case is broad discovery across substantial source, followed by an exact read of the specific scope that needs modification.

## 3. Proposed read policy

Make filtering depend on the purpose of the read.

| Purpose | Recommended behavior |
|---|---|
| Locate an implementation or understand a large file | Use JEV when source is substantial and a clear task exists. |
| Read a known small function or exact line range | Prefer a direct exact read; filtering may offer little benefit. |
| Prepare a patch | Read the target scope exactly, including the context needed to make the change. |
| Enumerate every occurrence, compare exact literals, or establish absence | Use complete deterministic retrieval and exact inspection. Filtering cannot establish completeness. |
| Inspect unsupported or structurally ambiguous source | Use conservative line-based filtering or exact reading, depending on uncertainty. |
| JEV unavailable or evaluation incomplete | Preserve uncertain source and expose the fallback status. |

Keep `filter:false` as an explicit override. Do not silently widen `offset` or `limit`, change pagination, or treat omitted ranges as searched-and-absent evidence.

## 4. Give JEV a compact description of the active task

Provide a bounded task description containing:

- The active user objective.
- The immediate purpose of this read.
- Explicitly named symbols, paths, APIs, or literal values.
- Requirements that affect evidence selection, such as cancellation, error handling, compatibility, or exhaustive coverage.

For example, a read investigating cancellation should say that the task is to trace timeout and cancellation behavior, and that evidence includes abort propagation, cleanup, and partial-result handling. “Find timeout” is less useful.

Build this description from the existing task state and tool query. Avoid an extra generative-model call solely to create it. Avoid sending the whole transcript to JEV. When a follow-up is ambiguous, preserve the established task instead of replacing it with a context-free latest message.

Treat the immediate query as a refinement of the active requirements. If its meaning cannot be resolved reliably, retain source more conservatively or use exact reading.

## 5. Chunk by source structure and attach context before evaluation

For supported code, prefer functions, methods, declarations, and meaningful statement blocks. Use existing verified graph symbol spans where available; graph coverage and freshness must remain explicit. The [graph inspect path](../../packages/graph/src/navigation/inspect.ts) already exposes file outlines and verified symbol source.

For other formats, use their natural structure: Markdown sections, configuration entries, or whole-line blocks. Keep the current line-based path as a fallback so read remains useful without graph indexing.

For each candidate, provide:

- The original path and source coordinates.
- Its enclosing symbol or section.
- The exact source text under evaluation.
- A compact signature or enclosing condition if the candidate is part of a larger unit.
- Relevant locally resolved declarations needed to interpret it.

Split oversized functions into bounded blocks while preserving their signature and enclosing control-flow context. Do not ask JEV to decide that half of a guard or exception branch is irrelevant without showing the condition that gives it meaning.

A compact outline can help orient JEV and the coding model. It must report incomplete coverage and must not become a reason to discard everything outside an indexed subset.

## 6. Separate direct evidence, supporting context, and caveats

Evaluate these as separate Boolean questions for each candidate:

| Question | Meaning |
|---|---|
| Direct evidence | Does this range implement, define, or test behavior needed for the stated task? |
| Supporting context | Does this range provide a declaration, prerequisite, configuration, or side effect needed to interpret the selected behavior? |
| Caveat or conflicting evidence | Does this range show an exception, limitation, or behavior that could change the answer or invalidate a proposed change? |

Use precise criteria with concrete examples. For a cancellation task, cleanup in a `finally` block and abort-signal wiring are supporting or direct evidence even if they contain none of the user's exact search terms.

Ask these questions together against the same bounded state. TypeSafe supports several independent questions sharing one state, avoiding repeated submission of that state. Its passage-classification cookbook also demonstrates separate evidence and contradiction judgments. These examples support the architecture, but their thresholds and results do not establish accuracy for this repository's code. [State and parallel questions](https://docs.typesafe.ai/concepts/state), [Passage classification](https://docs.typesafe.ai/cookbooks/classifying_rag_passages).

Start conservatively: a candidate is eligible for omission only when all relevant judgments are valid and below a calibrated omission threshold, and no deterministic retention rule applies. Missing or uncertain judgments retain the candidate.

Keep 0.05 as the initial comparison point rather than immediately increasing it. Requiring several low judgments does not make their errors independent or prove an error bound; their combined behavior must be measured.

Use a separate Score question only if graded prioritization becomes necessary and demonstrates a benefit. A Boolean probability should not be treated as a measure of relevance magnitude.

## 7. Preserve dependencies with host logic

After JEV selects evidence, expand the selected spans to preserve the structure needed to understand them:

- Enclosing signatures and control-flow conditions.
- Referenced local constants, types, and configuration defaults when they affect interpretation.
- Relevant initialization and side effects.
- Error branches, fallback paths, and cleanup associated with the selected behavior.
- Supporting tests when they are part of the investigation.

Resolve these relationships with parsers or verified graph information where possible. Use JEV for semantic judgment, while the host owns source coordinates, dependency expansion, and output assembly.

Replace unconditional first-chunk retention with specific structural context when that context can be identified reliably. Keep the existing leading-chunk and neighboring-chunk behavior as a fallback for files whose structure cannot be recovered.

Dynamic references, reflection, incomplete graph coverage, and unresolved dependencies should increase retention or trigger an exact read. Do not recursively include every dependency across the repository; use bounded expansion and report unresolved scope.

## 8. Separate examined source from returned source

Today, the source page is bounded before JEV runs. Therefore, filtering cannot discover evidence beyond that page.

Keep three budgets explicit:

1. **Examined source:** the requested candidate window.
2. **JEV evaluation:** how much of that window can be judged within token and latency limits.
3. **Returned evidence:** the selected source plus the dependencies and metadata needed by the coding model.

Initially, preserve the existing page contract. Introduce a broader discovery window only through explicit semantics, rather than silently reading beyond the requested range for classification.

An output target should be a soft goal. If essential or uncertain evidence exceeds it, expand the result or return a clear recovery path. A hard top-K cutoff could omit the one exception that changes the answer.

Always report the difference between source outside the requested page, source omitted by filtering, and source truncated by output limits. A short result must not imply complete inspection.

## 9. Return verbatim evidence with inexpensive recovery

Return source in its original order, with original line numbers and a content hash. Do not use JEV to rewrite code or generate summaries; its documented role is structured judgment. [TypeSafe generation limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

Include a compact indication of omitted ranges and how to recover them. Keep detailed probabilities and evaluation traces in host diagnostics rather than repeatedly adding them to the coding-model prompt.

Recovery should support:

- Exact inspection of an omitted range.
- Reading an enclosing scope whose dependencies remain unclear.
- Continuing pagination when evidence may be outside the examined window.
- Reclassifying against a corrected task description.

For the initial rollout, preserve the existing all-negative fallback. Later, evaluate an alternative that returns an outline and recoverable ranges when evaluation is complete and no direct evidence is found. Such a result must say “no evidence selected in this window,” and must not claim that the implementation does not exist.

A page with unknown or failed judgments remains source that needs consideration. Cancellation should continue to cancel the tool rather than emit a fallback after the task has ended.

## 10. Cache evaluations and avoid repeated source delivery

Cache judgments using keys that include:

- Workspace identity and source path.
- File content hash and candidate coordinates.
- Task description and immediate read purpose.
- Any enclosing or dependency context supplied to JEV.
- Question schema, policy version, and pinned JEV model version.

Do not reuse a selection after the file, task, context, or questions change. Do not assume differently worded tasks are equivalent through loose semantic matching. A changed task must be evaluated against the original source, rather than only the previously filtered subset.

Caching JEV judgments saves JEV calls. Reducing duplicate source in coding-model context is a separate optimization.

For overlapping reads, return previously unseen ranges plus a reference to ranges already present in the active model context. This requires a reliable record of what the next request actually contains. A range visible only in the UI, or removed by compaction, cannot be referenced as though the coding model still has its text.

Preserve tool-call/result pairing and the original transcript. Avoid changing historical results merely to save bytes. Prefer preventing duplicate new delivery first; introduce older-result compaction as a separately evaluated change.

## 11. Batch according to context and question budgets

The existing batches of eight contain different chunks. The source is already distributed across batches rather than copied in full into every request. Increasing batch size mainly reduces repeated task and question overhead; it should not be credited with eliminating repeated full-file submission that does not currently happen.

Group related candidates so necessary context is shared without filling the state with unrelated source. Budget both state tokens and question count.

The local evaluator permits up to 64 questions. Three questions per candidate allow at most 21 candidates per request under that limit; practical batches may need to be smaller because of source size and context quality. The existing batch size of eight would produce 24 questions.

TypeSafe currently documents a 64k-token total request limit and a 32k limit for state plus the longest question for JEV 1.13. These are ceilings, not recommended batch sizes. Large unrelated states can reduce accuracy. [Model limits](https://docs.typesafe.ai/models).

Pin a model version while calibrating thresholds and cache keys. The current adapter defaults to `jev-latest`, whose behavior can change when the alias moves. Record the actual responding model version and evaluate upgrades before reusing calibrated policy. [Model aliases](https://docs.typesafe.ai/models).

## 12. Measure the actual savings

Track four outcomes independently:

| Outcome | Measurement |
|---|---|
| Coding-provider tokens | Input and output usage across the complete task, including recovery and later replay. |
| All-provider tokens | Coding-provider usage plus JEV usage. Tokenization may differ by provider. |
| Monetary cost | Provider-specific rates, including cached input and any cache-write charges. |
| Latency and accuracy | Task completion time, evidence retention, answer correctness, and patch/test outcomes. |

For each read, record examined, selected, and returned source sizes; source token estimates for the target coding model; JEV input/output usage; evaluation latency; cache hits; fallback reasons; and subsequent exact rereads. Aggregate these over the session rather than equating source bytes with billed tokens.

For a simplified comparison:

```text
Coding-provider input saved
  = total baseline input tokens − total proposed-path input tokens

Combined cost saved
  = baseline coding cost − proposed coding cost − additional JEV cost
```

Baseline and proposed costs must include their respective recovery calls and outputs. Use provider-reported usage for final comparisons. Local token estimates help isolate source contributions but cannot replace usage accounting.

### Illustrative example

Assume a baseline read adds 6,000 tokens to the coding model, while the selected result adds 2,000. If that result appears in three subsequent model requests, the source contribution falls from 18,000 to 6,000 tokens: 12,000 coding-provider input tokens saved.

If JEV consumes 8,000 tokens, combined input consumption falls by only 4,000 in this simplified case. If the result is used just once, coding-provider input still falls by 4,000, but combined input grows from 6,000 to 10,000. Recovery reads could reduce or eliminate either saving.

These are illustrative quantities, not measured results. Cached input can also change the monetary comparison. Savings on source that was already cheaply cached may be smaller than raw token counts suggest.

TypeSafe currently lists JEV 1.13 at $0.042 per million input tokens with free output tokens. At that published rate, an 8,000-input-token evaluation costs approximately $0.000336. Use the account's applicable rates when evaluating real tasks, and keep rates separate from cached usage records. [Published pricing](https://docs.typesafe.ai/models).

## 13. Validate accuracy before tightening omission

Build a read-specific evaluation set from realistic tasks and source snapshots. Include:

- Locating and explaining implementations.
- Debugging failures requiring several functions or files.
- Preparing small patches after broad discovery.
- Error handling, cleanup, defaults, and cancellation.
- Exceptions or tests that contradict the apparent main behavior.
- Long functions crossing chunk boundaries.
- Relevant declarations far from their uses.
- Short follow-ups that depend on previous user requirements.
- Changed files, stale indexes, missing graph coverage, and malformed source.
- All-negative judgments, partial evaluation, deadlines, and recovery.
- Exhaustive questions and absence claims that should bypass filtering.

Label required evidence spans and the relationships that make them important. A matching keyword is insufficient: a retained guard without its body can still be unusable evidence.

Compare these variants incrementally:

1. Exact bounded reads as the baseline.
2. Current JEV read filtering.
3. Improved task descriptions and structured chunks.
4. Separate evidence questions with dependency retention.
5. Cached judgments and duplicate-delivery reduction.

Use the same task snapshots and coding-model settings. Evaluate on held-out tasks and repositories after selecting prompts and thresholds. Inspect failure cases by task category, not just aggregate averages.

Measure required-evidence recall, recovery frequency, unsupported claims, end-to-end answer quality, patch correctness where relevant, tokens, cost, and latency. Live judgments and coding-model outcomes are required; mocked selection tests establish mechanics only.

For critical cases, require every labeled necessary span or a successful recovery before accepting the answer or patch. Agree on a quality regression tolerance before tuning for savings, and report uncertainty in the comparison. No finite evaluation set can guarantee zero omission errors on future code.

The existing [web-fetch evaluation notes](../../packages/core/WEB_FETCH_EVALUATION.md) provide a useful measurement pattern and explicitly distinguish synthetic retention from live accuracy. Its authored results should not be carried over as read accuracy claims.

## 14. Delivery order

| Phase | Work | Completion evidence |
|---|---|---|
| 1. Establish the baseline | Instrument complete-task usage and assemble labeled read cases. | Current exact and filtered paths have comparable token, latency, recovery, and quality measurements. |
| 2. Improve evaluation context | Add a coherent task description and structure-aware candidates with conservative fallbacks. | Required-evidence retention improves or holds steady on held-out cases. |
| 3. Improve selection | Add separate evidence questions, selective dependency retention, and explicit omission recovery. | Coding-provider tokens decrease while task quality meets the agreed regression gate. |
| 4. Remove repeated work | Cache versioned judgments and reduce duplicate delivery when source remains in active context. | Additional savings survive task changes, source edits, and conversation compaction. |
| 5. Tune economics | Adjust eligibility, batching, deadlines, and omission thresholds using measured outcomes. | Benefits remain after JEV costs, cached provider input, and recovery are included. |

The first implementation should prioritize better task context and source structure while retaining the conservative omission policy. More aggressive thresholds, alternate all-negative output, and older-result compaction should follow only after their individual effects can be measured.
