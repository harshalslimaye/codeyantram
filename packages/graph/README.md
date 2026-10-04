# Graph

`@codeyantram/graph` is the workspace for project indexing and code navigation.
The package provides a workspace-bound CodeGraph adapter and global storage.

The [tools and synchronization strategy](STRATEGY.md) describes the proposed
navigation tools, synchronization after edits, freshness rules, and implementation order.

`openWorkspaceGraph(workspaceRoot)` opens persisted state or creates an empty
SQLite index for an explicit workspace root. The adapter provides `index()` for
full indexing, `sync()` for incremental reconciliation, `getStatus()`, `search()`,
`getSymbol()`, `getSource()`, `getCallers()`, `getCallees()`, and asynchronous
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

Opening does not index or sync automatically. Callers must inspect the index
state and operation reports. Full indexing reports extraction errors and index
completeness; sync reports failed paths and cancellation, and lock failures
reject. Queries do not establish filesystem freshness themselves. The operation
coordinator, watcher, automatic reconciliation, and agent tools remain subsequent
work. The CLI `init` command builds a missing/incomplete/outdated baseline or
incrementally syncs a complete index. `close()` rejects new work and drains admitted
asynchronous operations before closing SQLite. Read caches are invalidated
before queries so another instance's completed writes become visible.

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

The root `postinstall` applies the extension to installed platform bundles on
`npm install` and `npm ci`. It checks the exact package version and entire source
checksum, validates all bundles before writing, and supports repeated installs.
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

`core` will consume that API through agent navigation tools. The server will
manage graph instances for active workspaces and their lifecycle. `shared`
continues to own wire contracts used by the CLI and server. The graph package
does not own model calls, tool execution, HTTP routes, or terminal UI.

Source lives in `src/` and tests belong in `tests/`, mirroring source paths.
The root TypeScript configuration includes this package, and Vitest has a named
`graph` project. Run its tests from the repository root with
`npm test -- --project graph`.
