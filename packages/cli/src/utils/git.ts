/** Returns the current git branch name, or `undefined` when not in a git repo. */
export function getCurrentBranch(): string | undefined {
    const result = Bun.spawnSync(["git", "branch", "--show-current"], {
        stdout: "pipe",
        stderr: "pipe",
    });
    if (result.exitCode !== 0) return undefined;
    const branch = result.stdout.toString().trim();
    return branch.length > 0 ? branch : undefined;
}
