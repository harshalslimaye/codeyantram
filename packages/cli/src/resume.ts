export type ResumeTarget =
    | { mode: 'continue' }
    | { mode: 'resume'; id: string };

/**
 * Reads --continue/--resume off the CLI's own argv (process.argv.slice(2), not the raw
 * process.argv - see index.tsx) into what ResumeOnLaunch needs to act on. Kept as a plain
 * function, separate from the component that consumes it, purely so it's testable without
 * mounting anything.
 *
 * --continue takes no value - it means "the most recently updated session for this
 * project". --resume takes one required id (the value immediately following it, unless
 * that "value" is itself another flag, in which case it's treated as missing rather than
 * accidentally consumed as an id). If both are somehow given, --continue wins - "the most
 * recent" is unambiguous, while a malformed or missing --resume value has to fall through
 * to *something*, and starting fresh silently would hide a likely typo less obviously than
 * `undefined` id checks scattered at every call site.
 */
export function parseResumeTarget(argv: string[]): ResumeTarget | null {
    if (argv.includes('--continue')) return { mode: 'continue' };

    const resumeIndex = argv.indexOf('--resume');
    if (resumeIndex === -1) return null;

    const id = argv[resumeIndex + 1];
    if (id === undefined || id.startsWith('--')) return null;

    return { mode: 'resume', id };
}
