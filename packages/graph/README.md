# Graph

`@codeyantram/graph` is the workspace for project indexing and code navigation.
The package provides a workspace-bound CodeGraph adapter, synchronization
coordinator, and global storage.

## Source organization

`src/index.ts` is the public entry point; consumers continue to import from
`@codeyantram/graph`. Internal modules are grouped by responsibility:

| Folder | Responsibility |
| --- | --- |
| `contracts/` | Public graph, navigation, coordination, and storage types; read/index interfaces |
| `sdk/` | SDK compatibility, narrow backend ports, and locked connection setup |
| `storage/` | Canonical workspace identity and global database paths |
| `workspace/` | Public composition facade, operation admission/draining, indexing reports, and low-level lookups |
| `navigation/` | Separate explore/find/inspect/trace queries, shared source verification, references, and result bounds |
| `coordination/` | Serialized queue, change generations, reconciliation, scoped reads/edits, and workspace leases |

The workspace facade composes operations and applies lifecycle admission;
query modules own their navigation behavior. Each query receives only the
backend and verification capabilities it needs. Source containment and file
hash checks have one implementation shared by all navigation queries.

The coordinator orchestrates domain interfaces rather than deriving its contract
from the concrete SDK adapter. Queueing, change tracking, reconciliation, and
callback lifetimes remain separate modules. No implementation inheritance is
needed: collaborators are composed, and SDK-compatible structural ports can be
substituted independently. The SDK instance stays private to these modules.

## Workspace API

The [tools and synchronization strategy](STRATEGY.md) describes the proposed
navigation tools, synchronization after edits, freshness rules, and implementation order.

`openWorkspaceGraph(workspaceRoot)` opens persisted state or creates an empty
SQLite index for an explicit workspace root. The adapter provides `index()` for
full indexing, `sync()` for incremental reconciliation, `getStatus()`, `search()`,
`getSymbol()`, `getSource()`, `getCallers()`, `getCallees()`, `explore()`, `find()`,
`inspect()`, `trace()`, and asynchronous
`close()`. Its results use graph-package types; callers do not receive the raw
SDK instance. Search limits and traversal depths are bounded.

Codeyantram uses the project's `.gitignore` and CodeGraph's built-in indexing
defaults. Opening, indexing, syncing, and the CLI `init` command must not
generate `codegraph.json`. An existing project-owned file is still honored.

```ts
import {openWorkspaceGraph} from '@codeyantram/graph';

const graph = await openWorkspaceGraph(projectRoot);
try {
  const report = await graph.index();
  if (!report.success) throw new Error('Graph indexing did not complete.');
  const matches = graph.search('handleRequest');
  // Manual edits happen outside CodeGraph. Await sync before querying again.
  const sync = await graph.sync();
  if (!sync.success) throw new Error('Some changed files could not be indexed.');
} finally {
  await graph.close();
}
```

Opening the low-level adapter does not index or sync automatically. Callers must inspect the index
state and operation reports. Full indexing reports extraction errors and index
completeness; sync reports failed paths and cancellation, and lock failures
reject. Queries do not establish filesystem freshness themselves. The operation
watcher remains subsequent work. Core exposes read-only `explore`, `find`,
`inspect`, and `trace` tools, plus diagnostic `graph`, through the server-bound service. The CLI `init` command builds a missing/incomplete/outdated baseline or
incrementally syncs a complete index. `close()` rejects new work and drains admitted
asynchronous operations before closing SQLite. Read caches are invalidated
before queries so another instance's completed writes become visible.

## Coordinated access

Use `acquireGraphCoordinator(workspaceRoot)` for host code. Concurrent leases
for the same canonical root, including symlink aliases, share one coordinator
and connection in this process. The last `release()` stops admission, drains
queued operations, and closes SQLite. A subsequent acquisition opens a new
connection and epoch. A host can own a separate `WorkspaceGraphRegistry`.
Do not call `close()` directly on a leased coordinator; release its lease.

```ts
import {acquireGraphCoordinator} from '@codeyantram/graph';

const lease = await acquireGraphCoordinator(projectRoot);
try {
  const {value, freshness} = await lease.coordinator.query(graph =>
    graph.search('handleRequest'));
  const result = await lease.coordinator.edit(async ({markChanged, signal}) => {
    signal?.throwIfAborted();
    markChanged('src/handler.ts');
    await writeFile(handlerPath, updatedSource);
    return 'saved';
  });
  // Inspect result.mutation and result.graph separately. A sync retry must
  // never replay a successful or partially completed filesystem write.
} finally {
  await lease.release();
}
```

`initialize()` builds a missing, incomplete, or outdated baseline, otherwise
runs full-workspace incremental sync. The CLI and palette `/init` use this
same coordinator. Each `query()` reconciles first and then runs the callback
in the same queue slot, with only read methods exposed. Await source reads
inside that callback. Its reader expires when the callback completes.
Each recorded edit reconciles before returning. Paths are relative to the
bound root or absolute paths within it; authorization of writes belongs to
the caller. Record them immediately after writes or before writes that could
partially fail. This conservative record can include a file whose write failed
without changing it. A move must record both paths. A multi-file edit is one
callback and one awaited cleanup operation.

`notifyChanges(paths)` records external events; no paths means the scope is
unknown. A successful sync clears only generations known before it started.
New notifications trigger another pass, up to three passes, after which
navigation fails and dirty state is retained. With no watcher, manual edits
are still picked up by the full scan before each query. Failed sync reports,
lock errors, and cancellations retain dirty state and block navigation until
a later reconciliation succeeds. `getStatus()` is a cached diagnostic snapshot
that stays available during operations and failures.

Cancellation before a queued operation starts skips it. After a recorded write,
cleanup uses an independent signal with a 30-second deadline. A timeout does
not release the queue or close the connection until the SDK actually settles.
The returned edit result preserves both write and synchronization failures.

Freshness includes an epoch, observation revision, and reconciliation time.
Every successful reconciliation advances the local observation revision,
including no-op syncs that might observe another process's completed writes.
These are not stable symbol references or cross-process transaction versions.
External notifications during a query reject its result. Unreported external
writes during the callback are not an atomic filesystem snapshot. `explore()`
checks each returned file's SHA-256 against its indexed content hash around
source extraction and rejects mismatches with `GraphSourceChangedError`.
`find`, `inspect`, and `trace` use workspace- and file-hash-backed symbol
references and report `GraphNavigationError` with `stale_reference` when those
checks disagree. These remain valid through no-op observations and unrelated
file edits; they do not pin the coordinator's observation epoch/revision.
SDK cross-process locks protect writes, but the operation
queue itself is process-local. The server's lazy `WorkspaceGraphService` owns
a lease for its selected root and drains its operations before releasing it
on shutdown. Watchers and mutation tools remain subsequent work.

`explore()` normalizes the pinned SDK's JSON `buildContext` string into graph
types, keeps at most 20 symbols, 40 relationships, and five snippets (1,600
characters each), and bounds total serialized context to 24,000 characters.
Callers can request smaller budgets; defaults are 12 symbols and 12,000 characters.
Snippets carry relative paths, symbol line ranges, file hashes, and individual
truncation flags. Files over 1 MB are omitted. Context includes explicit indexed
coverage and truncation; an empty result does not prove a symbol is absent.

Focused queries run through the same adapter admission and coordinator queue:

```ts
const found = await coordinator.query(graph => graph.find('handleRequest'));
// Select the intended candidate when multiple symbols match.
const reference = found.value.matches[0]?.symbol.reference;
if (reference) {
  const inspected = await coordinator.query(graph => graph.inspect({reference}));
  const callers = await coordinator.query(graph => graph.trace(reference, {direction: 'callers', depth: 2}));
}
const outline = await coordinator.query(graph => graph.inspect({filePath: 'src/handler.ts'}));
```

`find()` bounds candidates to 50; file outlines also keep at most 50 symbols.
Defaults are 20 entries and 12,000 serialized characters, with budgets of
2,048–24,000 characters. `inspect()` verifies a complete reference before SDK
source extraction and checks fingerprints again afterward. `trace()` bounds
SDK BFS to the requested related-symbol limit plus a lookahead, at depth 1–3;
only resolved `calls` and `instantiates` edges are followed, with up to 100
returned relationships. Results preserve relative paths and available edge
locations/metadata. Trimmed context is marked, with no dangling returned edges.
References bind the canonical workspace hash, symbol ID, file path, and exact
file content hash. They require explicit rediscovery after relevant changes.

`resolveGraphStoragePaths(workspaceRoot)` resolves an existing directory to its
canonical path and hashes that path to select storage under the user's global
Codeyantram directory. It returns paths without creating directories or opening
a database. On macOS/Linux the intended layout is:

```text
~/.config/codeyantram/graphs/<workspace-hash>/
  codegraph.db
  codegraph.lock
```

On Windows the base is `%APPDATA%/codeyantram/graphs`, with the existing home
directory fallback when `APPDATA` is absent. SQLite sidecars will live beside
the database. Separate checkouts get separate indexes; symlink aliases share
one index. Project-specific configuration can remain trackable in the source
workspace, including future files inside `.codegraph/`.

CodeGraph 1.6.2's public facade derives storage from the source root. The tracked
[`patch-codegraph.mjs`](../../scripts/patch-codegraph.mjs) install script adds a narrow
`CodeGraph.connect(sourceRoot, databasePath, {create})` factory and derives the
instance's lock and database-replacement checks from its actual SQLite path.
Extraction, resolution, source reads, and project configuration continue to use
the original source root. No symlink or generated Git exclusion is needed.

The script also fixes 1.6.2's Git scanner: tracked paths absent from the working
tree are skipped by both scan variants. Otherwise an unstaged deletion or move
produces a read error during initialization and incremental sync. Existing-file
permission and other I/O errors remain failures. This requires no Git staging
and lets the SDK remove stale symbols and relationships normally.

The root `postinstall` applies the extension to installed platform bundles on
`npm install` and `npm ci`. It checks the exact package version and entire facade
and extraction source checksums, validates all bundles before writing, and supports repeated installs.
An upstream upgrade requires reviewing the extension and updating its version
and checksum. If install scripts were disabled, run
`node scripts/patch-codegraph.mjs` before opening a graph. The
adapter fails explicitly when the extension is unavailable. Large indexing
jobs may need the host runtime's `--liftoff-only` flag as recommended by the
upstream npm SDK; the CLI runtime is not changed here.

Developers share source and configuration through Git; each user's graph must
be reconciled against their own working tree. Existing databases are opened
without silently replacing invalid files. Database creation/opening, full
indexing, and sync share the same global cross-process lock path.

`core` consumes that API through agent navigation tools. The server
manages graph instances for active workspaces and their lifecycle. `shared`
continues to own wire contracts used by the CLI and server. The graph package
does not own model calls, tool execution, HTTP routes, or terminal UI.

Source lives in `src/`; integration tests and focused module tests live in `tests/`.
The root TypeScript configuration includes this package, and Vitest has a named
`graph` project. Run its tests from the repository root with
`npm test -- --project graph`.
