import { spawnSync } from 'node:child_process';

/** Returns the current git branch name, or `undefined` when not in a git repo (or git
 * itself isn't installed). Synchronous by design - called directly from a component's
 * render body (see home.tsx), not an effect, so there's no good place to await a result.
 * node:child_process rather than Bun.spawnSync so this runs under plain Node.js too - see
 * shared.ts's own comment on the same tradeoff for the server's `bash` tool. */
export function getCurrentBranch(): string | undefined {
    const result = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf-8' });
    // result.error covers a missing git binary (ENOENT); result.status is `null` rather
    // than 0 for that case too, but checking both makes the "not a repo, or no git"
    // outcome explicit rather than relying on that fallthrough.
    if (result.error || result.status !== 0) return undefined;

    const branch = result.stdout.trim();
    return branch.length > 0 ? branch : undefined;
}
