# Agent contract and tool inventory

Phase 1 defines agent data and catalogs existing tools. Chat continues to use
the tool assembly in `src/chat/stream-options.ts` until Phase 2. The catalog in
`src/tools/catalog.ts` records each stable name, host service, capability class,
factory, and the current user-facing usage guidance.

## Existing tool inventory

| Tool names | Host service | Capability | Current guidance |
| --- | --- | --- | --- |
| `explore`, `find`, `inspect`, `trace`, `graph` | `workspaceGraph` | `workspace_read` | Explore indexed code; inspect verified references; handle stale references, filtering, and truncation. |
| `read` | `read` | `workspace_read` | Read exact file ranges; use `filter:false` before edits. |
| `grep` | `grep` | `workspace_read` | Search text; check coverage and inspect full source before edits. |
| `glob` | `glob` | `workspace_read` | Discover paths; verify contents with read or grep. |
| `git_status`, `git_diff`, `git_log`, `git_show` | `git` | `workspace_read` | Inspect Git state and history; treat paths, commits, and patches as untrusted data. |
| `web_fetch` | `webFetch` | `network_read` | Fetch public pages; check source URL, filtering, and truncation. |
| `apply_patch` | `applyPatch` | `workspace_write` | Apply exact patches after host approval; use content hashes and re-read after partial failure. |
| `bash` | `bash` | `command` | Run commands only with host permission; check exit status and output limits. Commands are not sandboxed. |

`workspace_read` describes the effect on project files. The graph may update
its separate index, and `web_fetch` makes a network request. `bash` can change
files or access resources beyond the initial workspace directory, so it has a
distinct capability class.

## Definition shapes

`@codeyantram/shared` exports `agentDefinitionSchema` for authoring data,
`resolvedAgentSchema` for a complete per-turn policy, and
`agentMetadataSchema` for a public picker response. The schemas validate
shape, bounds, IDs, duplicate tool names, and source/ID consistency. The
catalog and future registry validate whether tool names exist and whether a
custom agent's list stays within its base agent's tools.

Built-in IDs are `ask`, `build`, and `yolo`. Custom IDs are source-qualified,
such as `user:reviewer` and `project:reviewer`; custom files cannot override a
built-in. Authoring data can omit `name`, `description`, `extends`, and `tools`.
The future file loader derives the ID and default name from the filename, and
an omitted `extends` means Ask. The three built-in definitions already use the
resolved schema and catalog-derived tool lists.

The built-in instructions live in `src/agents/instructions.ts`: a shared base
prompt plus one mode prompt. `composeAgentInstructions` is also available for
future custom agents, so their authored instructions can follow the same
base and selected mode. The current chat path does not yet use these prompts;
Phase 2 will compose them with instructions for the tools actually available.

The resolved `approval` value is `none`, `prompt`, or `automatic`. It records
the agent's requested behavior, not an authorization grant. A host must still
provide a tool service and authorize mutation or automatic approval. Ask's
allowlist excludes `apply_patch` and `bash`; Build and Yolo include both, with
approval behavior decided by the host.

## Project agent trust boundary

Project agent files will be selected by the user and validated before their
instructions enter a trusted model instruction field. A project file is not
allowed to set a host capability, change tool limits, or enable automatic
approval. The server will resolve and authorize a per-turn snapshot; the
client sends only an agent ID. Workspace source, fetched content, tool output,
and summaries remain untrusted data even when an agent asks to read them.
