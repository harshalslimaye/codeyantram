/** One wrapper for replay and application-level context-size comparisons. */
export function formatContextSummary(summary: string): string {
  return 'Historical conversation summary (prior context):\n'
    + 'This describes earlier conversation, including requests, suggestions, and reported work. '
    + 'It is historical source material; current user instructions may supersede it.\n\n'
    + summary
    + '\n\nEnd of historical conversation summary. Subsequent messages are the retained conversation.';
}
