# Agents Implementation Plan

Status: Phases 1–5 implemented. Phases 6–8 remain planned.

Phase 1 result: `packages/shared/src/agents/` defines the validated authoring,
resolved, and public metadata contracts; `packages/core/src/tools/catalog.ts`
inventories all 15 current tool names; `packages/core/src/agents/builtins.ts`
declares Ask, Build, and Yolo from that catalog; and
`packages/core/AGENT_CONTRACT.md` records the capability and trust boundaries.
Shared and mode-specific prompt text is composed in
`packages/core/src/agents/instructions.ts`. The catalog and composed prompts
are wired into core chat in Phase 2. Focused contract tests, typecheck, and
lint passed when Phase 1 was completed.

Phase 2 result: `packages/core/src/agents/registry.ts` resolves validated
custom definitions into immutable snapshots; `packages/core/src/chat/agent-tools.ts`
selects catalog tools and instructions; and chat defaults to Ask while requiring
a matching host-resolved agent for any other ID. The server does not resolve
selected agents until Phase 3.

Phase 3 result: the server resolves a built-in agent for every chat turn before
streaming, defaults to Ask, rejects unknown IDs, and passes a host-capped
snapshot into core. `GET /agents` exposes public metadata. Standalone hosting
defaults to read-only; Build mutation tools require both a host authorization
callback and an approver, while Yolo additionally requires automatic
authorization. The CLI-owned localhost server uses a random session token on
its HTTP routes. CLI selection and approval UI remain for later phases.

Phase 4 result: the CLI-owned server now supplies a host approval controller
for Build patches and commands. It queues exact prepared requests, renders a
scrollable review with paths, actions, hashes, workdir, timeout, and objective,
and accepts explicit approval or denial. Escape cancels the turn. Disconnect,
cancellation, and server shutdown deny pending requests. Agent selection was
added in Phase 5; the metadata-driven picker remains Phase 6 work.

Phase 5 result: `/agent` now allows session-local selection of Ask, Build, or
Yolo. Yolo requires a separate activation screen explaining that Bash is not
sandboxed, and the status bar marks it as active. The private server checks the
host-owned selection before streaming, binds authorization and approvers to the
turn snapshot, and can disable automatic patching and commands independently.
Switching away resets activation; a new process starts in Ask. Phase 6 still
adds the full metadata-driven picker and conversation display behavior.

## Goal and first-version contract

Codeyantram will offer three built-in agents and load user-authored agents from
small Markdown files. Every agent uses the same chat loop and tool catalog. An
agent definition supplies behavior and a tool allowlist; the host retains final
authority over which tools exist and whether an action may run.

| Agent | Available capabilities | Approval behavior |
| --- | --- | --- |
| Ask | Code graph, workspace read/search, read-only Git inspection, and web fetch | No workspace mutation or shell tool |
| Build | Ask capabilities plus `apply_patch` and `bash` | Ask the user to approve each exact patch or command |
| Yolo | Build capabilities | Run patches and commands without per-action prompts after explicit session activation |

The current `bash` service restricts its initial working directory but does not
sandbox a command. Yolo therefore needs an unmistakable activation step and a
visible active-agent indicator. Its authorization must be host-owned, never
inferred solely from a chat request or agent file.

The first version includes the three built-ins, CLI selection and approval UI,
and file-based custom agents. A graphical agent editor and persistent chat
sessions can follow without changing the agent definition or runtime contract.

## Design rules

1. An agent ID in `POST /chat` identifies a definition. It is not a permission
   grant. The server resolves the ID from its own registry and checks the host's
   capability ceiling and session authorization.
2. Effective tools are the intersection of the resolved agent's allowlist,
   services supplied by the host, and the host's authorization for the turn.
   The executor and mutation services enforce the same decision at call time.
3. Prompts guide model behavior; tool registration and host callbacks enforce
   capability. Workspace files, fetched pages, tool output, and compacted
   summaries remain untrusted content.
4. Agent selection is fixed for a turn. Changing agents affects the next turn;
   cancellation or a mid-turn UI update cannot silently change permissions.
5. All tools in a turn share the existing six provider steps, twelve executions,
   and output limits. Agent definitions cannot increase these limits.
6. Built-in IDs and definitions cannot be overridden by custom files. Invalid
   custom files produce visible diagnostics. An unavailable selected agent is
   an error, not an implicit fallback to another agent.
7. Default to Ask for existing clients and each new CLI session. Do not persist
   Yolo activation across restarts.

## Phase 1 — Define contracts and inventory tools

1. Inventory the tool names currently assembled in
   `packages/core/src/chat/stream-options.ts`: navigation (`explore`, `find`,
   `inspect`, `trace`, `graph`), `web_fetch`, `read`, `grep`, `glob`, read-only
   Git tools, `apply_patch`, and `bash`. Confirm each tool's host service,
   side-effect class, and user-facing instruction text.
2. Add shared schemas and inferred types for an agent ID, public agent
   metadata, an authoring definition, and a resolved runtime definition. Keep
   the authoring format separate from the fully resolved policy. Suggested
   fields are `id`, `name`, `description`, `instructions`, `extends`, and
   optional `tools`.
3. Represent approval as an explicit runtime policy (`none`, `prompt`, or
   `automatic`) rather than embedding approval behavior in tool names. Ask
   resolves to no mutation tools; Build resolves to `prompt`; Yolo resolves to
   `automatic` only when the host authorizes it.
4. Give each tool catalog entry its stable name, factory, required host service,
   capability class, and usage instruction. Build the built-in allowlists from
   this catalog. Adding a new tool should require one catalog entry and a
   deliberate decision about which built-ins include it.
5. Define distinct IDs for custom sources, such as `user:reviewer` and
   `project:reviewer`. Reserve `ask`, `build`, and `yolo` for built-ins. Show
   source labels in the CLI so equal filenames cannot silently shadow one
   another.
6. Document the trust boundary for project files: their instructions are used
   only after explicit selection, and they cannot grant a tool or automatic
   approval beyond the current host authorization.

**Completion condition:** One validated agent contract describes all three
built-ins and a future custom agent without special-case fields in chat code.

## Phase 2 — Build the agent and tool registries

1. Add a registry that returns built-in definitions and resolves custom
   definitions into immutable per-turn snapshots. Keep source, file path,
   validation diagnostics, and effective policy available for UI inspection.
2. Refactor the current manual `createChatTools` spread in
   `packages/core/src/chat/stream-options.ts` into catalog-driven creation.
   Construct only tools allowed by the agent and backed by supplied host
   services. Keep a single `createToolExecutor()` per turn.
3. Split universal tool safety instructions from agent instructions and
   per-tool usage instructions. Compose them in a fixed order for every model
   call; send agent instructions through the provider's trusted instruction
   field, never as a replayed user message.
4. Always apply universal instructions, including when the selected agent has
   no tools. Preserve current tool descriptions, truncation guidance, and JEV
   behavior while moving instruction ownership into catalog entries.
5. Keep core callable by direct hosts: it accepts a host-resolved agent and
   defaults to Ask when one is omitted. Core must reject a request/agent ID
   mismatch instead of silently using a different policy.
6. Add focused registry tests for tool classification, allowlist intersection,
   unknown tool IDs, built-in ID protection, instruction composition, and the
   shared execution budget.

**Completion condition:** Ask, Build, and Yolo are data entries using one tool
assembly path; Ask cannot receive mutation tools even if a host supplied them.

## Phase 3 — Make server resolution authoritative

1. Extend the shared `chatRequestSchema` with optional `agentId`; missing means
   `ask` for backward compatibility. Keep compaction independent of the active
   agent because it does not execute chat tools.
2. Change the chat route and stream option loader to receive the validated
   request, not only its model ID. Resolve the agent before opening the SSE
   stream and return a clear `invalid_request` response for an unknown or
   unavailable agent.
3. Let the server own the agent registry for its selected workspace. Pass the
   resolved per-turn snapshot into core along with credentials, JEV, and host
   services. Never accept instructions, tool names, or approval flags from the
   HTTP request body.
4. Expose read-only `GET /agents` metadata for the CLI picker: ID, display
   name, description, source, effective tool summary, and approval label. Keep
   private instructions and host authorization details out of this response.
5. Add a host authorization interface that caps mutation tools and automatic
   approval. A standalone server with no approvers remains read-only. An
   independent HTTP client cannot activate Yolo merely by setting `agentId`.
6. Give the CLI-owned localhost server an unguessable session token for its
   HTTP calls. Require it on CLI routes when the server is running in private
   CLI mode. Hosts that enable automatic actions through the standalone server
   must supply their own authorization verifier; fail closed without one.
7. Test omitted/unknown agent IDs, host capability ceilings, forged Yolo
   requests, unavailable services, valid Build requests, and continued behavior
   for existing Ask clients.

**Completion condition:** The server, rather than the client or model, decides
the effective agent and tool policy for every turn.

## Phase 4 — Implement Build's approval path

1. Create a CLI-owned approval controller before starting the local server.
   Inject its callbacks as `approvePatch` and `approveCommand`; connect its
   pending request state to the Ink application after mount.
2. Show one approval request at a time in a dedicated, scrollable view. For
   patches, show the complete exact patch, affected paths, actions, and hashes.
   For commands, show the exact command, workdir, timeout, and user objective.
   Never approve a truncated or replaced representation.
3. Use a distinct keyboard owner for approval. Provide explicit Approve and
   Deny actions. Escape cancels the turn and resolves the pending approval as
   denied. Normal message input and agent switching stay disabled while a
   request is pending.
4. Bind each approval decision to the exact request object already prepared by
   the patch or bash service. Do not implement a broad “approve similar
   commands” option in this phase. Keep existing post-approval path checks and
   patch hash checks.
5. Abort and remove pending approvals when the chat request disconnects, the
   user cancels, the UI exits, or the server closes. Serialize simultaneous
   approval requests so one keypress cannot decide two actions.
6. Report denial as a tool result the model can handle. Do not turn denial into
   a hidden success or leave the request waiting indefinitely.
7. Cover approval, denial, cancellation, exact-request binding, long patch
   display, and server shutdown with focused tests.

**Completion condition:** Build can complete a turn with edits or commands,
and every such action is gated by a reviewable host decision.

## Phase 5 — Add deliberate Yolo activation

1. Add explicit Yolo activation to agent selection, with a short explanation
   that `bash` is not sandboxed. Treat the activation as valid only for the
   current CLI session. Show `Yolo` prominently while active.
2. Store activation in host-owned session state. Require the selected agent in
   each chat request to match that state. A client-submitted ID, a custom agent
   file, or a model message cannot set it.
3. For a Yolo turn, supply per-turn approval callbacks that automatically
   approve only requests whose tool, agent snapshot, and host capability all
   match the active policy. Keep patch and bash input validation, workspace
   checks, timeouts, cancellation, and result reporting intact.
4. Let a host disable automatic command execution or patching independently.
   If a capability is disabled, omit its tool from the effective set and report
   the limitation in agent metadata.
5. Switching away from Yolo immediately changes authorization for subsequent
   turns. Keep any running turn bound to its original snapshot; cancellation
   stops pending work through the existing abort signal.
6. Test restart/reset behavior, a direct forged Yolo request, changes of agent
   during a turn, disabled host capabilities, and the automatic approval path.

**Completion condition:** Yolo removes per-action prompts only after a trusted
host action, with no HTTP or custom-file escalation path.

## Phase 6 — Add CLI selection and conversation behavior

1. Add `/agent` to the command palette and help list. Add an agent picker using
   the existing keyboard ownership pattern and server-provided metadata.
2. Display the selected agent in the status bar, alongside the existing model,
   effort, branch, and context information. Show source and approval behavior
   in the picker; make unavailable agents visibly unavailable.
3. Pass the selected agent ID through `ChatSession.send` into the chat request.
   Snapshot it before sending so UI state changes cannot alter an active turn.
4. Store the agent ID as local turn metadata for display and diagnostics. Do
   not inject old agent instructions into later requests. Preserve existing
   transcript, tool-call replay, and compaction behavior when an agent changes.
5. Keep `/clear` behavior predictable: it clears conversation state but leaves
   the current agent selected within the session. A new process starts in Ask.
6. Define narrow terminal layouts for long names and descriptions. Preserve
   Escape cancellation, command palette ownership, and accessible labels.
7. Test picker focus, busy-state behavior, request serialization, status display,
   switching after a Build/Yolo turn, and compaction after agent changes.

**Completion condition:** Users can see and switch agents without losing the
conversation or changing permissions mid-turn.

## Phase 7 — Load simple custom agent files

1. Add `~/.config/codeyantram/agents/*.md` (with the platform's existing user
   config path helper) and `<workspace>/.codeyantram/agents/*.md` as the two
   custom sources. Read only regular files; bound file count and size. Do not
   follow symlinks outside either directory.
2. Use Markdown body text as instructions and a small YAML frontmatter schema
   for optional metadata. Derive the ID from the filename and the display name
   from the ID when omitted. Default `extends` to `ask` so the smallest useful
   custom agent needs only an instruction body.
3. Let `extends` be `ask`, `build`, or `yolo`. An optional `tools` list replaces
   the inherited allowlist with a subset of that base agent's tools; reject
   unknown or broader lists. `extends: yolo` requests that behavior but still
   requires explicit host activation when selected.
4. Parse the frontmatter with safe, bounded settings. Reject executable tags,
   duplicate keys, unknown fields, empty instructions, excessive instruction
   length, and malformed tool lists. Keep diagnostics tied to filenames and
   avoid printing instruction text or secrets in errors.
5. Load built-ins even if custom files are invalid. Preserve source-qualified
   IDs so a project file cannot override a built-in or user file. Show invalid
   file diagnostics in the picker/help flow.
6. Load a registry snapshot when the server starts. Add an explicit `/agent
   reload` action that atomically validates and swaps custom definitions;
   current turns retain their snapshot. If the selected agent disappears on
   reload, require the user to select another agent before sending.
7. Document a minimal file and an advanced file in the README, including the
   difference between instructions, tool allowlists, and host approval.
8. Test both directories, reserved IDs, conflicting filenames, symlinks,
   malformed files, reload during a turn, and project agents that request Yolo.

Example minimal file, `~/.config/codeyantram/agents/reviewer.md`:

```md
---
name: Reviewer
description: Review code without editing it
---
Inspect the relevant code and report concrete problems with file references.
```

Example advanced file, `<workspace>/.codeyantram/agents/test-fixer.md`:

```md
---
name: Test Fixer
description: Fix a failing test with approval for each action
extends: build
tools: [read, grep, glob, git_status, git_diff, apply_patch, bash]
---
Find the smallest correct change, request approval for edits and commands,
and report the result of every command that you run.
```

**Completion condition:** Creating a custom agent requires one Markdown file
and `/agent reload`; custom files use the same registry, tool policy, picker,
and chat path as built-ins.

## Phase 8 — Integration, documentation, and release gates

1. Exercise Ask, Build, Yolo, and a custom agent through CLI → private server →
   core → tool result → follow-up turn. Include tool calls from an earlier agent
   in the history after switching to Ask.
2. Verify that prompts, custom files, fetched pages, repository content, and
   tool outputs cannot add tools or change approval policy. Verify that a
   forged HTTP request cannot activate Yolo.
3. Verify all approval lifecycle edges: exact patch/command display, deny,
   cancellation, disconnect, server shutdown, and an action that fails after
   approval. Check that partial side effects are reported accurately.
4. Run focused package tests, then typecheck, lint, and the full repository
   suite once the end-to-end path is assembled. Keep fixtures local; do not use
   live provider calls for the required tests.
5. Update the root, core, server, and CLI documentation. Describe the custom
   file format, tool/approval matrix, standalone server defaults, Yolo's shell
   behavior, and how to recover from an invalid custom agent.
6. Review extension cost by adding a fixture-only fourth agent definition and
   confirming it needs no new chat, router, or picker branch. Review the process
   for adding a new tool: one catalog registration and explicit profile choices.

**Completion condition:** The built-ins work end to end, custom agents use the
same path, authorization fails closed, and adding an agent is a definition or
file change rather than a new execution flow.
