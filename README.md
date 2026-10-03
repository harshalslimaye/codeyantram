# Codeyantram

A coding agent portfolio project organized as an npm workspace monorepo.

| Workspace | Intended role | Planned stack |
| --- | --- | --- |
| `packages/server` | HTTP server | Node.js, Express, TypeScript |
| `packages/cli` | Terminal interface | Node.js, Ink, React, TypeScript |
| `packages/core` | Agent logic and shared schemas | Vercel AI SDK, Zod, TypeScript |
| `packages/shared` | Shared application utilities | Node.js, TypeScript |

The root workspace holds shared TypeScript development tools. `core` owns model communication and Zod schemas, including provider packages for BYOK with OpenAI, Anthropic, Google, and OpenAI-compatible endpoints. The CLI and server depend on `core`; the CLI also uses `shared` for application paths used across workspaces.

Direct dependencies use exact versions. If a package is used by more than one workspace, keep its declared version identical in each workspace. The root `package-lock.json` records the resolved dependency tree.

Requires Node.js 22.12+ on the 22.x line, 24.x, or 26+.

## Run the CLI

```sh
npm run cli
```

The initial Ink interface includes an editable prompt, the current project path and Git branch, and the static model label.

## CLI themes

Use `/theme` in the CLI to choose a built-in or custom theme. Theme files,
configuration paths, precedence, and the custom JSON format are documented in
[packages/cli/THEMES.md](packages/cli/THEMES.md).

## Tests

Vitest is configured at the repository root with named `cli` and `shared`
projects. Add projects for `core` and `server` when those workspaces gain tests.

```sh
npm test                             # Run all tests once
npm run test:watch                   # Watch and rerun affected tests
npm run test:coverage                # Print coverage and write coverage/index.html
npm test -- --project cli            # Run only CLI tests
npm test -- --project shared         # Run only shared tests
npm test -- packages/cli/tests/models/preferences.test.ts
npm run typecheck                    # Check source, tests, and Vitest configuration
```

The CLI workspace also supports `npm test --workspace=@codeyantram/cli`.

Each package has a `tests/` folder beside `src/`. Keep all tests in `tests/`,
mirroring the relative source paths: `src/theme/utils/colors.ts` is tested by
`tests/theme/utils/colors.test.ts`. Use `*.test.ts` or `*.test.tsx` and import test
APIs explicitly from `vitest`. Tests run in the Node environment.
Use temporary directories for filesystem tests and mock external boundaries;
tests must not use real API keys or the user's configuration. Mocks and stubbed
environment variables are restored between tests; clean up temporary files and
timers in teardown hooks.

Coverage uses V8 and includes untested source files across all workspaces.
Reports are informational while the suite grows; no coverage thresholds are
enforced yet. Generated coverage and Vitest artifacts are ignored by Git.
