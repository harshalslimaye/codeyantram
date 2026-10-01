# Codeyantram

A coding agent portfolio project organized as an npm workspace monorepo.

| Workspace | Intended role | Planned stack |
| --- | --- | --- |
| `packages/server` | HTTP server | Node.js, Express, TypeScript |
| `packages/cli` | Terminal interface | Node.js, Ink, React, TypeScript |
| `packages/core` | Agent logic and shared schemas | Vercel AI SDK, Zod, TypeScript |

The root workspace holds shared TypeScript development tools. `core` owns model communication and Zod schemas, including provider packages for BYOK with OpenAI, Anthropic, Google, and OpenAI-compatible endpoints. The CLI and server depend on `core` and each have only their interface or HTTP dependencies.

Direct dependencies use exact versions. If a package is used by more than one workspace, keep its declared version identical in each workspace. The root `package-lock.json` records the resolved dependency tree.

Requires Node.js 22 or newer.

## Run the CLI

```sh
npm run cli
```

The initial Ink interface includes an editable prompt, the current project path and Git branch, and the static model label.
