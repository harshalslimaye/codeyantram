/**
 * The prompt sent when the user runs /init. Read by the Build agent as a normal user
 * message - every write it makes still goes through the ordinary approval gate, so this
 * is a prompt template, not a privileged code path.
 */
export const INIT_PROMPT = `Create or update \`AGENTS.md\` at the project root - the file CodeYantram reads on every turn as project-specific instructions (see the "Project instructions" section of the README).

The goal is a compact instruction file that helps a future session avoid mistakes and get productive quickly. Every line should answer: "would an agent likely get this wrong without help?" If not, leave it out.

## Investigate first

Read the highest-signal sources before writing anything:
- README and any root-level docs
- package manifests, lockfiles, and workspace config
- build, test, lint, format, and typecheck configuration
- CI workflow files
- existing instruction files: \`AGENTS.md\`, \`CLAUDE.md\`, \`.cursorrules\`, \`.cursor/rules/\`, \`.github/copilot-instructions.md\`

If the architecture is still unclear after that, read a small number of representative source files - prefer the ones that show how the system is wired together (entrypoints, routing, the main data flow) over leaf files.

Prefer executable sources of truth over prose: if a README claims something a config file or script contradicts, trust the config or script and verify before writing it down.

## What belongs in the file

- exact commands for build, test, lint, typecheck - especially ones that aren't the obvious default, and how to run a single test or a single package in a monorepo
- required ordering when it matters (e.g. "generate before build")
- project or package boundaries, and where the real entrypoints live
- conventions specific to this repo that differ from the language or framework's defaults
- testing quirks: fixtures, required services, flaky or slow suites, anything that needs setup first
- constraints already written down in an existing instruction file that are still true

Leave out: generic language/framework advice, exhaustive file trees, obvious conventions, anything you could not verify by reading the repo. When in doubt, omit it - a short accurate file beats a long speculative one.

## If AGENTS.md already exists

Read it first and improve it in place rather than rewriting from scratch: keep what's still verified true, drop what's stale or unverifiable, and fold in anything missing that you found while investigating.

If a \`CLAUDE.md\` also exists, treat it as prior art to consolidate into \`AGENTS.md\` rather than a second file to maintain - CodeYantram only reads \`CLAUDE.md\` when there is no \`AGENTS.md\` (see the loader's precedence).

Keep the result short. If the repo is simple, the file should be simple.` as const;
