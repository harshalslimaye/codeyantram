/** Shared number formatting for anything that shows a raw token count to the user -
 * message-list's per-turn usage summary, input-bar's context-window readout, and the
 * context overlay's window-capacity figures (now up to ~1.05M - see models.ts) all need
 * the same "1.2k, not 1234" treatment. */
export function formatTokenCount(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

/** "3h ago"-style formatting for a session's updatedAt in the picker - a glance at a
 * relative age, not an exact one, is what matters for picking which session to resume.
 * Falls back to a plain date once a session is old enough that "Nd ago" stops being a
 * useful measure of recency. */
export function formatRelativeTime(timestampMs: number): string {
    const diffSeconds = Math.round((Date.now() - timestampMs) / 1000);
    if (diffSeconds < 60) return 'just now';

    const diffMinutes = Math.round(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;

    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.round(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return new Date(timestampMs).toLocaleDateString();
}

/** Cuts `text` to `maxLength` (ellipsis included) if it's longer, otherwise leaves it
 * alone - the same one-line-per-row treatment message-list.tsx already gives a long
 * web_fetch URL, needed here for a session title long enough to wrap: OverlayList's row
 * is a single-line flex row with a fixed-width column on the right (message count, age),
 * and a wrapped title collides with it rather than pushing it down. */
export function truncate(text: string, maxLength: number): string {
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
