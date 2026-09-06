/** Shared number formatting for anything that shows a raw token count to the user -
 * message-list's per-turn usage summary, input-bar's context-window readout, and the
 * context overlay's window-capacity figures (now up to ~1.05M - see models.ts) all need
 * the same "1.2k, not 1234" treatment. */
export function formatTokenCount(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}
