# Evaluating conversation compaction

The automated suite verifies contracts, request settings, cancellation, context
selection, rollback, and summary replay. It uses HTTP fixtures with the installed
SDK adapters and never calls live providers. Hand-authored fixture summaries are
expected transport results, not evidence of a model's summarization quality.
No live quality or cost evaluation has been performed for this implementation.

## Representative scenario

The synthetic coding conversation in
[tests/chat/compaction-scenario.ts](tests/chat/compaction-scenario.ts) includes
an objective, exact file paths and APIs, a corrected port, implementation
constraints, an assistant proposal, reported changes, an interrupted test run,
diagnostic logs, and pending work. The first two turns form an eligible older
prefix; the last two remain verbatim. The long recent diagnostic turn also
makes a later summary refresh eligible.

[The end-to-end regression](../cli/tests/chat/compaction-e2e.test.ts) sends this
conversation through a CLI-owned server, core, and the actual provider adapters.
It checks all three provider-switch paths, material serialized context reduction,
unchanged transcript, previous-summary refresh using only new history, truncated
refresh rollback, subsequent replay of the last good summary, and clear.

```sh
npm test -- --project cli packages/cli/tests/chat/compaction-e2e.test.ts
```

## Separate live evaluation

A live evaluation needs authorization for paid calls and configured provider
keys. Keep it separate from `npm test`. Use the synthetic fixture, not private
conversation data, and keep credentials out of saved request/result artifacts.

1. Submit only the first two turns to `compactChat`, recording the selected
   model, date, duration, available usage, and actual returned summary. Use the
   feature's supported low effort and output cap. Do not substitute the golden
   fixture summary for a generated result.
2. Review the result against the checklist below. Preserve a copy of the
   original source for each finding; a literal match alone does not establish
   that the surrounding claim is correct.
3. Continue once with the generated summary, retained two turns, and a question
   asking for the current port, exact wrapper API, validation still pending,
   and the next authorized work. Compare with a full-history baseline using
   the same model, effort, and question. Record corrections needed in either
   answer and both calls' reported input/output/cache usage when available.
4. Refresh with the generated previous summary and newly eligible third turn.
   Repeat the checklist, including whether uncertainty was lost or the previous
   summary was copied without incorporating new information.
5. Repeat with the configured OpenAI, Anthropic, and Google models, including
   one follow-up on a different provider. Record unknown usage as unknown.

| Criterion | Pass condition |
| --- | --- |
| Objective and requests | Manual compaction, compatible `ChatSession.send(text, model, effort)`, and `ChatSession.compact(model)` survive. |
| Constraints | Full transcript and latest two turns remain distinct from active context; limits and deployment prohibition remain clear. |
| Exact literals | `packages/shared/src/chat/context.ts`, `formatContextSummary(summary)`, `20%`, `4 MB`, `12000`, and `maxOutputTokens=4096` survive where needed. |
| Corrections | Port `43188` supersedes `43187`; the two are not reported as equally current. |
| Reported work | Controller/revision guards and wrapper are described as assistant-reported changes, not independently verified file state. |
| Validation | `npm run typecheck` passed; `npm test` was interrupted and a full suite pass is unknown. Diagnostic logs do not establish complete validation. |
| Authorization | The assistant's deployment suggestion does not become permission; no deployment or commit is claimed. |
| Uncertainty and pending work | Provider ordering review, failed/cancelled history checks, regressions, and documentation remain pending. |
| Repeated compaction | New facts and uncertainty survive alongside still-applicable earlier decisions in one replacement summary. |

Report missing facts, changed literals, unsupported claims, and follow-up
corrections, rather than only a single quality score. Record canonical context
bytes and the CLI estimate separately from provider-measured tokens. A 20%
replaced-prefix byte reduction is not a measured token or whole-request savings
guarantee. Include the compaction call when assessing net cost, and distinguish
cached input from uncached input. One successful synthetic scenario does not
establish quality or savings for arbitrary coding conversations.
