import type { UserMessage } from '@codeyantram/shared';

const MAX_TITLE_LENGTH = 60;
const FALLBACK_TITLE = 'Untitled session';

/** Trims `text` to at most `maxLength` characters, breaking on the last space inside that
 * window rather than mid-word, and marking the cut with an ellipsis. A word boundary
 * can't always be found close enough to be worth preferring (a single very long token) -
 * in that case this just hard-cuts at maxLength rather than leaving the title unbounded. */
function truncateOnWordBoundary(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;

    const slice = text.slice(0, maxLength);
    const lastSpace = slice.lastIndexOf(' ');
    const boundary = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;

    return `${boundary.trimEnd()}…`;
}

/**
 * Derives a session title from raw text - normally the first user message. Never throws
 * and never returns an empty string, so a title is always something a picker row can show.
 *
 * - Whitespace (including newlines from a multi-line prompt) collapses to single spaces.
 * - A leading slash-command token is dropped, since "/init generate docs for this repo"
 *   should title as "generate docs for this repo", not literally the command. If nothing
 *   is left after stripping it (the message *was* just "/init"), the original text is
 *   used instead of falling all the way back to the generic title - the command itself is
 *   still more informative than "Untitled session".
 * - The result is capped at MAX_TITLE_LENGTH on a word boundary.
 * - Empty (or all-whitespace) input falls back to a fixed, generic title rather than an
 *   empty string - regenerable later (see renameSession), so a bad title is never
 *   permanent.
 */
export function deriveTitle(rawText: string): string {
    const collapsed = rawText.replace(/\s+/g, ' ').trim();
    if (collapsed === '') return FALLBACK_TITLE;

    const withoutSlashCommand = collapsed.replace(/^\/\S+\s*/, '').trim();
    const source = withoutSlashCommand !== '' ? withoutSlashCommand : collapsed;

    return truncateOnWordBoundary(source, MAX_TITLE_LENGTH);
}

/** Convenience over deriveTitle for the common case: a session's title comes from its
 * first user message, which may carry more than one text part. */
export function deriveTitleFromMessage(message: UserMessage): string {
    const text = message.parts.map(part => part.text).join(' ');
    return deriveTitle(text);
}
