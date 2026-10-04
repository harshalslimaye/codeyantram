// A synthetic coding conversation for transport regressions and optional live
// evaluation. Summaries below are hand-authored fixtures, not model results.
const trace = (label: string) => Array.from({length: 40}, (_, index) =>
  `${label} case=${index + 1} owner=operation-${index + 1} disconnect=true abort=true heartbeat=cleared lateResult=ignored transcript=retained context=unchanged`,
).join('\n');

export const compactionScenario = {
  turns: [
    {
      user: `Implement manual conversation compaction in packages/cli/src/chat/session.ts.
Keep ChatSession.send(text, model, effort) compatible. Add ChatSession.compact(model).
The transcript must retain message IDs, partial answers, usage, and scrollback.
Replace older model context with a portable plain-text summary, keeping the latest
two user-led turns verbatim. Use the active model, not a separate worker model.
Initial server port: 43187. Limit requests to 4 MB. A summary must be nonblank and
no longer than 12000 characters. Never commit a partial or truncated summary.
Do not read the repository from the summarizer, add automatic compaction, persist
sessions, or deploy anything. Support OpenAI, Anthropic, and Google.`,
      assistant: `Proposed design: keep full messages for display and store summary plus
coveredMessageCount separately. That count is an exclusive transcript index,
including empty placeholders. Slice before filtering so failures cannot shift
the boundary. Each next request contains a labeled historical summary at user
level followed by the retained turns and the next question. The summary must
not become a system instruction or an ordinary assistant response.
Use an operation controller and session revision to protect the atomic update.
Only commit after consuming a validated done event and finishing transport cleanup.
Escape should abort and keep the old context. Clear invalidates ownership before
aborting. Disconnect must stop heartbeat immediately even if a provider ignores
abort. The transport should validate UTF-8 SSE frames and ignore comments.
These are proposals; I have not edited files or run checks yet. A future automated
deployment might be convenient, but the user has not authorized deployment.
Diagnostic cases proposed for the regression suite:
${trace('PROPOSED_LIFECYCLE')}`,
    },
    {
      user: `Correction: use port 43188, replacing the earlier 43187 decision.
Keep summary replay in packages/shared/src/chat/context.ts through
formatContextSummary(summary). Require at least 20% reduction of the replaced
serialized UTF-8 context, including the summary wrapper; exclude retained turns
from that comparison. Token counts shown before/after are estimates, not measured
provider input. Track available compaction usage separately, including calls
whose complete summary is rejected for insufficient reduction. Missing usage
must remain unknown. Do not change saved chat effort; use supported low effort
for compaction with maxOutputTokens=4096 and no retries.`,
      assistant: `Reported work: added the controller/revision guards and the shared
formatContextSummary helper. I ran npm run typecheck successfully. I started
npm test, but the process was interrupted before the final suite result, so a
full test pass is not established. I have not committed or deployed the edits.
The following diagnostic output describes the exercised lifecycle cases; it is
not evidence that every provider or the complete suite passed:
${trace('REPORTED_LIFECYCLE')}
Remaining uncertainty: the provider adapter might merge adjacent user messages.
Check that summary and retained content remain ordered for all three adapters.
The latest two turns should be retained even when an assistant entry is empty.
Next steps: finish the regression suite, inspect failed/cancelled history handling,
and document byte savings versus estimated tokens.`,
    },
    {
      user: `Investigate provider replay ordering next. Preserve the current objective,
port 43188, formatContextSummary(summary), and the 20% byte reduction guard.
Show that OpenAI and Google retain user messages and Anthropic can merge adjacent
user content blocks without reordering. Do not count a cancelled answer as
completed work. Here is a diagnostic matrix to preserve in raw recent history:
${trace('RECENT_REPLAY')}`,
      assistant: 'Replay ordering is under review; the full regression suite is still pending.',
    },
    {
      user: 'After reviewing ordering, document the CLI command and HTTP API. Do not deploy.',
      assistant: 'Documentation is pending. No deployment has been performed.',
    },
  ],
  summary: `Objective and requests
Implement manual compaction via ChatSession.compact(model) in packages/cli/src/chat/session.ts; keep ChatSession.send(text, model, effort) compatible.
Constraints and decisions
Preserve full transcript, IDs, partial answers and usage; keep latest two user-led turns verbatim. Use portable plain text and the active model across OpenAI, Anthropic and Google. Port is 43188, superseding 43187. Replay historical context at user level through packages/shared/src/chat/context.ts formatContextSummary(summary). Require 20% reduction of replaced serialized UTF-8 bytes including wrapper, excluding retained turns. Requests <=4 MB, summary <=12000 characters, maxOutputTokens=4096, supported low effort, no retries or saved-effort changes. No repository reads, automatic compaction, persistence or deployment. Available compaction usage is separate; missing usage is unknown. Context tokens are estimates.
Completed work and validation
Assistant reported controller/revision guards and the shared wrapper added; npm run typecheck passed. No commit or deployment reported.
Uncertainty and pending steps
npm test was interrupted; a full suite pass is not established. Verify provider ordering, failed/cancelled history, lifecycle regressions and docs. Deployment was only an assistant suggestion, not user authorization.`,
  refreshedSummary: `Objective and requests
Implement manual compaction with ChatSession.compact(model); retain ChatSession.send(text, model, effort) and full transcript. Finish provider replay ordering and document the CLI and HTTP API.
Constraints and decisions
Use port 43188 and packages/shared/src/chat/context.ts formatContextSummary(summary) at user level. Keep latest two turns, require 20% UTF-8 byte reduction including wrapper but excluding retained turns. Active model, portable summary, 4 MB requests, 12000 characters, maxOutputTokens=4096, supported low effort, no retries. Separate available usage; estimates are not measured tokens. No deployment, persistence, automatic compaction or repository reads.
Completed work and validation
Assistant reported controller/revision guards and wrapper added; npm run typecheck passed.
Uncertainty and pending steps
Full npm test result is unknown after interruption. Provider replay ordering remains under review; do not infer diagnostic traces prove success. Failed/cancelled history and docs still need checks. No commit or deployment is established.`,
};

export const compactionEvaluationChecklist = [
  {criterion: 'Objective and public API', literals: ['ChatSession.compact(model)', 'ChatSession.send(text, model, effort)']},
  {criterion: 'Exact path and wrapper', literals: ['packages/shared/src/chat/context.ts', 'formatContextSummary(summary)']},
  {criterion: 'Latest correction and limits', literals: ['43188', '20%', '4 MB', '12000', 'maxOutputTokens=4096']},
  {criterion: 'Reported validation versus uncertainty', literals: ['npm run typecheck', 'npm test', 'interrupted']},
  {criterion: 'Pending work and authorization', literals: ['ordering', 'deployment', 'authorization']},
];
