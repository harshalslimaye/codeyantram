# Graph

`@codeyantram/graph` is the workspace for project indexing and code navigation.
The package provides a workspace-bound CodeGraph adapter, synchronization
coordinator, and global storage.

The [tools and synchronization strategy](STRATEGY.md) describes the proposed
navigation tools, synchronization after edits, freshness rules, and implementation order.

`openWorkspaceGraph(workspaceRoot)` opens persisted state or creates an empty
SQLite index for an explicit workspace root. The adapter provides `index()` for
full indexing, `sync()` for incremental reconciliation, `getStatus()`, `search()`,
`getSymbol()`, `getSource()`, `getCallers()`, `getCallees()`, `explore()`, and asynchronous
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
watcher remains subsequent work. Core exposes read-only `explore` and diagnostic
`graph` tools through the server-bound service. The CLI `init` command builds a missing/incomplete/outdated baseline or
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
Durable symbol-reference rules remain necessary before `inspect` and `trace`.
SDK cross-process locks protect writes, but the operation
queue itself is process-local. The server's lazy `WorkspaceGraphService` owns
a lease for its selected root and drains its operations before releasing it
on shutdown. Watchers and focused navigation tools remain subsequent work.

`explore()` normalizes the pinned SDK's JSON `buildContext` string into graph
types, keeps at most 20 symbols, 40 relationships, and five snippets (1,600
characters each), and bounds total serialized context to 24,000 characters.
Callers can request smaller budgets; defaults are 12 symbols and 12,000 characters.
Snippets carry relative paths, symbol line ranges, file hashes, and individual
truncation flags. Files over 1 MB are omitted. Context includes explicit indexed
coverage and truncation; an empty result does not prove a symbol is absent.

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

Source lives in `src/` and tests belong in `tests/`, mirroring source paths.
The root TypeScript configuration includes this package, and Vitest has a named
`graph` project. Run its tests from the repository root with
`npm test -- --project graph`.
