# CodeGraph tools and synchronization strategy

This is the implementation strategy. The graph workspace now provides global
storage paths, a workspace-bound SDK adapter, and a synchronization coordinator.
The CLI and palette `init` commands build or refresh the selected project's
global index through that coordinator. The server now owns a lazy workspace
lease and drains graph work on shutdown; palette `init` uses that service.
Read-only `explore` and diagnostic `graph` now execute through chat, stream
activity to the CLI, and survive history replay and compaction. Focused queries,
mutation tools, and watchers remain unimplemented.

## Package responsibilities

| Package | Responsibility |
| --- | --- |
| `graph` | CodeGraph adapter, workspace-scoped operation queue, indexing, reconciliation, bounded queries, freshness metadata, and resource cleanup |
| `core` | Tool definitions and executors, file mutations, tool-call loop, and injection of a workspace graph into tool execution |
| `server` | Select the authorized workspace, acquire/release graph instances, and manage shutdown |
| `shared` | Serializable navigation inputs/results, tool events, and structured mutation/sync errors |
| `cli` | Supply the selected workspace at startup and display indexing, tool activity, and freshness failures |

Bind the graph to an explicit, canonical workspace root supplied by the host.
Use the project's `.gitignore` and CodeGraph's built-in defaults; neither the
adapter nor the CLI `init` command should generate `codegraph.json`. Respect
existing project-owned configuration without modifying it.
Do not expose workspace selection, database access, SQL, index deletion, or
full-rebuild operations as model-controlled navigation arguments. Query tools
receive the bound service, not a global singleton or the raw CodeGraph instance.

## Navigation tools

Start with `explore` and a diagnostic `graph`. Add focused queries
when the first tool is working end to end.

| Tool | Proposed input | Result | Adapter implementation |
| --- | --- | --- | --- |
| `explore` | Implemented: `query`, optional `maxNodes`/`maxCharacters` | Relevant symbols, verified source snippets, relationships, freshness, coverage, and truncation | JSON `buildContext`, normalized by our adapter |
| `graph` | Implemented: empty object | Lifecycle state, last successful reconciliation, bounded pending changes, watcher disabled, and last sync failure | Cached service/coordinator state without opening the graph |
| `find` | Query, bounded result limit | Candidate symbols and locations | `searchNodes` |
| `inspect` | Revision-scoped symbol reference | Symbol metadata and source | `getNode` and `getCode`, subject to pinned-release verification |
| `trace` | Symbol reference, direction (`callers`, `callees`, or `impact`), bounded depth/limit | Related symbols and relationship provenance | `getCallers`, `getCallees`, or `getImpactRadius` |

The documented TypeScript facade supplies search, traversal, impact, context,
and incremental sync. Verify exact option and result types against the installed
release before implementing these adapters. `buildContext` is not a promise of
identical output to the separately implemented MCP `codegraph_explore` tool.
See the [API reference](https://colbymchenry.github.io/codegraph/reference/api/)
and [MCP reference](https://colbymchenry.github.io/codegraph/reference/mcp-server/).

Validate per-tool inputs with Zod before execution. Apply host-controlled upper
bounds to query length, node count, traversal depth, and serialized result size.
Never silently return the first ambiguous symbol. Return candidates instead.
Every successful navigation response includes an index epoch/revision, relative
paths, source line ranges where available, and explicit truncation/coverage
information. Preserve relationship provenance when the SDK supplies it.

Treat symbol IDs as references to one index revision. The current upstream
implementation notes that IDs can change when edits move a symbol's line.
Define stable content revisions or fingerprint-backed references before adding
`inspect` and `trace`: the coordinator's current observation revision advances
on each successful reconciliation, including no-op scans, and cannot directly
serve as a reusable symbol-reference version. Reject references from a different
epoch/content revision and return a recoverable stale-reference error.
Rediscovery may use path, qualified name, and kind, but
must still handle ambiguity. See the
[upstream facade](https://github.com/colbymchenry/codegraph/blob/main/src/index.ts).

## Synchronization contract

After every logical agent edit, reconcile the graph before returning a fully
successful edit result. A patch that changes several files is one logical edit:
write its files first, then reconcile all touched paths before it completes.
Creates, deletes, moves, and formatter changes follow the same rule. For a move,
include both the old and new paths.

Use one coordinator per canonical workspace in each server process. It orders
agent mutation callbacks, reconciliation, and navigation queries. The callbacks
contain the actual filesystem operations owned by core. Initially serialize
these operations for correctness; introduce concurrent reads only after the
consistency tests pass.

The edit sequence is:

1. Validate arguments and workspace paths; acquire the workspace operation slot.
2. Record a pending mutation before its first write.
3. Execute the edit and record paths actually changed, including partial writes.
4. In cleanup, await incremental reconciliation whenever any write occurred.
5. Inspect the SDK's returned diagnostics as well as thrown errors. Advance the
   local revision and clear only the changes covered by a successful sync.
6. Return the write outcome and graph outcome together, then release the slot.

Do not clear a newer pending change just because an earlier sync completed.
Retain per-path change generations and reconcile again when needed. A sync
failure retains dirty state. Avoid a full rebuild after ordinary edits; use
incremental `sync()`. The
[indexing guide](https://colbymchenry.github.io/codegraph/guides/indexing/)
distinguishes incremental reconciliation from full indexing.

For the first implementation, use full-workspace incremental `sync()` for
startup, each completed edit, and each navigation query. This favors freshness
over scan cost and covers changes whose paths are unknown. After profiling,
use changed-path sync for known edits if the pinned SDK supports it; retain
full reconciliation for shell commands, branch changes, watcher gaps, and
index/config changes. Scoped sync must also refresh dependent relationships.

## Navigation freshness and external changes

Every navigation query first passes through initialization and reconciliation
inside the operation queue. Await sync and query execution in the same slot so
an agent edit cannot interleave between them. If sync cannot establish the
required freshness, return a graph error rather than silently querying stale
relationships. `graph` remains usable when navigation is unavailable.

Use a watcher to reconcile external editor saves and other processes' changes
automatically. External event bursts may use a short debounce, but an agent
edit never waits for that timer. A navigation request must bypass the debounce
and reconcile first. Startup also reconciles changes made while the service
was closed. Watcher failure switches the service to reconciliation-before-query
mode and is visible through status.

Route watcher-triggered sync through the same coordinator. The current upstream
entry point exports `FileWatcher`, whose callback can delegate to our queue;
verify that export in the pinned npm release before choosing it. Do not enable
both that watcher and independent `CodeGraph.watch()` auto-sync, since the latter
would write outside our operation queue. See the
[upstream watcher](https://github.com/colbymchenry/codegraph/blob/main/src/sync/watcher.ts).

Watcher notifications are not an atomic filesystem snapshot. Other processes
can edit during a query. Validate source fingerprints when assembling responses
that mix indexed locations with live source; retry within a bound or report
staleness when they disagree. Before applying a later edit, check its expected
source content/hash rather than trusting old graph line numbers.

Graph freshness describes the indexed scope, not complete repository coverage.
Keep direct reads/search available for documentation, configuration, excluded
files, unsupported source, and recovery. Surface those coverage limits rather
than interpreting an empty result as proof that code does not exist.

## Failures, cancellation, and shared contracts

The coordinator returns the mutation outcome and graph outcome separately;
recorded paths are conservative when a filesystem write could partially fail.
An applied edit followed by a sync failure must not look like an unapplied edit.
Extend the shared tool errors with graph-specific codes and serializable details
before implementing mutation tools. Report a mutation state (`applied`,
`partially_applied`, or `not_applied`), changed paths, and graph state separately.
Recovery retries sync; it must not automatically replay the write. Preserve
the original mutation failure if both a partial write and its sync fail.

Cancellation before the first write may stop the operation. After a write,
record its outcome and reconcile even if the originating chat is cancelled.
Use a workspace-owned bounded cleanup operation rather than the cancelled chat
signal. A timeout leaves the graph dirty and blocks normal navigation until
recovery; it does not prove the underlying SDK operation has stopped.

The current shared tool call/result contracts can carry navigation payloads,
but chat message parts and stream events still support only text. Complete tool
history conversion, result replay, CLI display, context estimation, and
compaction before exposing graph tools to the model. Keep source and tool
results as untrusted conversation data, separate from system instructions.

## Lifecycle and multiple sessions

Store generated graph state in the user's global Codeyantram directory, using
`getUserGraphDirectory()` from shared and `resolveGraphStoragePaths()` from graph.
The macOS/Linux layout is `~/.config/codeyantram/graphs/<workspace-hash>/codegraph.db`;
Windows uses the existing `%APPDATA%/codeyantram` configuration base. Put SQLite
sidecars and locks in the same global workspace directory. Source projects need
no graph-generated Git exclusions, and `.codegraph/` remains available for
future shared project configuration.

Hash the canonical absolute workspace root with SHA-256. Separate checkouts and
worktrees get independent indexes; symlink aliases resolve to the same index.
Moving a checkout to a different canonical path selects a new index. Keep the
source workspace root separate from the storage directory in every adapter call.
Share source and indexing configuration through Git; each developer reconciles
their own graph against their own files, including local edits and branch changes.

Upstream `getCodeGraphDir()` joins the source root and a directory name;
`CODEGRAPH_DIR` accepts only a single segment, not an absolute storage path.
The adapter uses the tracked, version/checksum-checked install extension in
the root [`scripts/patch-codegraph.mjs`](../../scripts/patch-codegraph.mjs):
an explicit database-path connection factory,
with locks and replacement checks derived from that database path. Indexing,
configuration, and source reads still use the original project root. The
adapter supports explicit indexing, reopening, sync reports, queries, and
draining resource cleanup. See the package README for its current API and the
[upstream directory implementation](https://github.com/colbymchenry/codegraph/blob/main/src/directory.ts).

The server acquires one workspace lease on first graph use; opening a chat
session does not index or open SQLite. Establish the initial baseline and
reconcile before enabling navigation. Track readiness, pending operations, sync failures,
and a service-local epoch plus revision counter. These counters identify our
responses; they are not a cross-process database transaction version.

Reuse one graph instance per workspace inside a server process. Each CLI already
owns its own server, so two CLIs can still access the same index from different
processes. Respect the SDK's cross-process locks and bounded lock retries, and
verify read-cache invalidation for indexes updated by another process. In-process
queues alone do not coordinate those sessions. The current upstream facade
contains indexing locks and read-cache invalidation APIs; verify their exact
behavior in the pinned release before claiming multi-session consistency.

On shutdown, stop watcher admission, reject new operations, and drain or actually
cancel in-flight work before closing the database. Do not close a connection
that a timed-out sync is still using. Persisted indexes survive service shutdown.

## Implementation order and acceptance checks

1. Pin the CodeGraph dependency in `graph` and build a narrow adapter. Verify
   independent global storage first: indexing must use the original source root,
   read its project configuration, and write the database/sidecars/locks only
   under global storage. Then verify initial indexing, reopening, queries, sync
   diagnostics, and cleanup on a temporary TypeScript fixture using the real
   installed SDK. Assert source-project files and Git ignore rules are unchanged.
2. Implement the workspace coordinator, awaited edit synchronization, and query
   freshness barrier. Prove create/update/delete/move behavior, dependent-edge
   refresh, sync failure after an applied write, cancellation after a write,
   and changes arriving during sync. Use controlled fake operations for races.
3. Integrate workspace selection and graph lifetime with the server and CLI.
   Verify startup catch-up, external saves, watcher failure, two sessions sharing
   a root, and shutdown without leaked watchers or open databases.
4. Add navigation schemas and `explore`/`graph`, then complete chat
   tool execution/replay/display/compaction. Exercise a provider-fixture turn
   through the server that calls a tool, receives its result, and continues.
5. Add focused navigation tools and mutation tools using the same coordinator.
   Verify that the immediate next graph query sees each completed edit, stale
   symbol references trigger rediscovery, and oversized results are bounded.

The first end-to-end scenario should find a function, read its callers, edit
it, await sync, and immediately retrieve the changed function and relationships.
Measure indexing/query/sync time and context size before tuning debounce,
changed-path sync, or concurrent reads.
