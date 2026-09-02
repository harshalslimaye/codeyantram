import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fg from 'fast-glob';
import ignore, { type Ignore } from 'ignore';
import { NOISE_DIRS_GLOB, resolveInProject, truncate } from './shared';

// fast-glob rather than Bun.Glob so the built server can run under plain Node.js.

const DEFAULT_MAX_RESULTS = 100;

/** Rejects patterns that could resolve outside the project root before they ever
 * reach fast-glob - an absolute pattern (e.g. "/etc/**") or one with a ".." segment
 * (e.g. "../../etc/**") would otherwise match anywhere on disk, unlike every other
 * path-based tool here, which runs its input through resolveInProject. */
function assertContainedPattern(pattern: string): void {
    if (pattern.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(pattern)) {
        throw new Error(`Pattern "${pattern}" must be relative to the project root`);
    }

    if (pattern.split(/[\\/]/).includes('..')) {
        throw new Error(`Pattern "${pattern}" must not contain ".." segments`);
    }
}

/** fast-glob throws synchronously for a malformed pattern (e.g. a non-string, or an
 * empty array if this were ever called with one) - normalizes that into the same
 * clean "Error: ..." shape every other tool failure takes here, instead of letting
 * fast-glob's own internal wording (e.g. "Patterns must be a string (non empty) or
 * an array of strings") leak straight through. */
async function safeGlob(pattern: string, options: fg.Options): Promise<string[]> {
    try {
        return await fg(pattern, options);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid glob pattern "${pattern}": ${message}`);
    }
}

/** Builds an `ignore` matcher from the project root's .gitignore, if one exists.
 * fast-glob's own `ignore` option matches with glob/micromatch semantics, not git's
 * ignore syntax (negation, anchoring, etc.), so .gitignore patterns are applied as a
 * post-filter with the `ignore` package instead of being fed straight into fast-glob. */
async function loadGitignore(cwd: string): Promise<Ignore> {
    const matcher = ignore();
    try {
        matcher.add(await readFile(join(cwd, '.gitignore'), 'utf-8'));
    } catch {
        // No .gitignore (or unreadable) - nothing to filter.
    }
    return matcher;
}

export async function execute(input: { pattern: string; dot?: boolean; maxResults?: number }, cwd: string): Promise<string> {
    assertContainedPattern(input.pattern);
    const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;

    const [matches, gitignore] = await Promise.all([
        safeGlob(input.pattern, { cwd, dot: input.dot === true, ignore: [NOISE_DIRS_GLOB] }),
        loadGitignore(cwd),
    ]);

    // Re-validates every match against resolveInProject rather than trusting that a
    // pattern already cleared by assertContainedPattern can only ever produce matches
    // syntactically inside cwd - a cheap sanity check against that invariant quietly
    // breaking (e.g. a future fast-glob option resolving symlinked dirs to absolute
    // paths), not a defense against anything currently reachable.
    const contained = matches.filter(match => {
        if (gitignore.ignores(match)) return false;

        try {
            resolveInProject(cwd, match);
            return true;
        } catch {
            return false;
        }
    });

    // Sorted for stable, deterministic output - callers can otherwise get a
    // differently-ordered list across identical calls, since fast-glob's own
    // result order isn't guaranteed.
    const sorted = contained.sort();
    if (sorted.length === 0) return 'No matches.';

    const truncationNote =
        sorted.length > maxResults ? `\n… ${sorted.length - maxResults} more matches truncated (maxResults=${maxResults})` : '';

    return truncate(sorted.slice(0, maxResults).join('\n') + truncationNote);
}
