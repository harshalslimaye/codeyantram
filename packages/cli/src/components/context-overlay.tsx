import { TextAttributes } from '@opentui/core';
import { contextUsage, latestUsageMessage, type AssistantMessage, type ChatMessage } from '@codeyantram/shared';
import { useChat } from '../providers/chat';
import { useModel } from '../providers/model';
import { useTheme } from '../providers/theme';
import { formatTokenCount } from '../utils/format';

const BAR_WIDTH = 30;

function renderBar(percent: number): string {
    const clamped = Math.max(0, Math.min(100, percent));
    const filled = Math.round((clamped / 100) * BAR_WIDTH);
    return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}

function formatBytes(bytes: number): string {
    return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
}

/** One label/value line, right-aligned value - the same row shape repeated down every
 * section below so the numbers line up under each other. */
function Row({ label, value }: { label: string; value: string }) {
    return (
        <box flexDirection="row" justifyContent="space-between">
            <text attributes={TextAttributes.DIM}>{label}</text>
            <text>{value}</text>
        </box>
    );
}

function SectionHeading({ children }: { children: string }) {
    return (
        <text attributes={TextAttributes.BOLD}>{children}</text>
    );
}

/** Sums inputTokens/outputTokens across every assistant message that has a usage field -
 * unlike contextUsage (which reads only the latest reading, since that single figure
 * already covers the whole prefix), a *cost* total is genuinely additive across turns. */
function sessionTotals(messages: ChatMessage[]): { turns: number; inputTokens: number; outputTokens: number } {
    let turns = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    for (const message of messages) {
        if (message.role !== 'assistant') continue;
        turns++;
        if (message.usage?.inputTokens !== undefined) inputTokens += message.usage.inputTokens;
        if (message.usage?.outputTokens !== undefined) outputTokens += message.usage.outputTokens;
    }

    return { turns, inputTokens, outputTokens };
}

/** Roughly four characters to a token. Deliberately crude: the server counts tool output
 * in characters (see toolUsageSchema) rather than shipping a tokenizer per provider for a
 * figure only ever read as a proportion. Everything derived from this is labelled with a
 * "~" and never presented as a measured count. */
const CHARS_PER_TOKEN = 4;

/**
 * Tool output summed across the whole session, not just the last turn - deliberately.
 * Every tool result is replayed verbatim on every later request, so a grep from six turns
 * ago is still occupying the window right now; a per-turn figure would understate it badly.
 * Sorted by size so the tool actually filling the window is the first line read.
 */
function sessionToolUsage(messages: ChatMessage[]): { toolName: string; calls: number; resultChars: number }[] {
    const totals = new Map<string, { toolName: string; calls: number; resultChars: number }>();

    for (const message of messages) {
        if (message.role !== 'assistant' || message.toolUsage === undefined) continue;
        for (const entry of message.toolUsage) {
            const running = totals.get(entry.toolName);
            if (running === undefined) {
                totals.set(entry.toolName, { ...entry });
                continue;
            }
            running.calls += entry.calls;
            running.resultChars += entry.resultChars;
        }
    }

    return [...totals.values()].sort((a, b) => b.resultChars - a.resultChars);
}

/** Which tools put the bytes in the window. Absent entirely for a session that has run no
 * tools, rather than rendering an empty heading. */
function ToolOutputSection({ messages, usedTokens }: { messages: ChatMessage[]; usedTokens: number }) {
    const perTool = sessionToolUsage(messages);
    if (perTool.length === 0) return null;

    const totalChars = perTool.reduce((sum, entry) => sum + entry.resultChars, 0);
    const totalTokens = Math.round(totalChars / CHARS_PER_TOKEN);
    // Against the current window reading rather than the session's summed input: the
    // question this answers is "how much of what I'm carrying right now is tool output",
    // and usedTokens is what the window is actually holding.
    const share = usedTokens > 0 ? Math.min(100, Math.round((totalTokens / usedTokens) * 100)) : 0;

    return (
        <box flexDirection="column">
            <SectionHeading>Tool output (session)</SectionHeading>
            {perTool.map(entry => (
                <Row
                    key={entry.toolName}
                    label={`${entry.toolName} ×${entry.calls}`}
                    value={`~${formatTokenCount(Math.round(entry.resultChars / CHARS_PER_TOKEN))}`}
                />
            ))}
            <Row label="Share of window" value={`~${formatTokenCount(totalTokens)} · ${share}%`} />
        </box>
    );
}

/**
 * Worker spend across the session.
 *
 * Kept visually and numerically apart from everything above it, because it is the one
 * figure here that is *not* about the context window: worker tokens are spent in a
 * separate context that is thrown away, so they never occupy a byte of the window this
 * overlay is otherwise describing. They are still real money, and without this line the
 * only number the UI shows - the context percentage - would make a turn that spent 40k on
 * three workers look identical to one that spent nothing.
 */
function SubagentSection({ messages }: { messages: ChatMessage[] }) {
    let count = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    for (const message of messages) {
        if (message.role !== 'assistant' || message.subagents === undefined) continue;
        count += message.subagents.count;
        inputTokens += message.subagents.inputTokens;
        outputTokens += message.subagents.outputTokens;
    }

    if (count === 0) return null;

    return (
        <box flexDirection="column">
            <SectionHeading>Subagents (session)</SectionHeading>
            <Row label="Workers spawned" value={String(count)} />
            <Row label="Worker tokens" value={`${formatTokenCount(inputTokens)} in · ${formatTokenCount(outputTokens)} out`} />
            <text attributes={TextAttributes.DIM}>Spent outside this window - workers keep their own context.</text>
        </box>
    );
}

/** The last turn's own input breakdown - cache read/write are a subset of inputTokens, not
 * an addition to it (same convention as message-list's cacheSummary), so this only ever
 * adds a cache-hit-rate line, never a second input figure. */
function LastTurnSection({ message }: { message: AssistantMessage }) {
    const usage = message.usage!;
    const hitRate =
        usage.cacheReadTokens !== undefined && usage.cacheReadTokens > 0 && usage.inputTokens !== undefined
            ? Math.round((usage.cacheReadTokens / usage.inputTokens) * 100)
            : null;

    return (
        <box flexDirection="column">
            <SectionHeading>Last turn</SectionHeading>
            <Row label="Input" value={formatTokenCount(usage.inputTokens!)} />
            {usage.outputTokens !== undefined && <Row label="Output" value={formatTokenCount(usage.outputTokens)} />}
            {usage.cacheReadTokens !== undefined && usage.cacheReadTokens > 0 && (
                <Row label="Cache read" value={formatTokenCount(usage.cacheReadTokens)} />
            )}
            {usage.cacheWriteTokens !== undefined && usage.cacheWriteTokens > 0 && (
                <Row label="Cache write" value={formatTokenCount(usage.cacheWriteTokens)} />
            )}
            {hitRate !== null && <Row label="Cache hit rate" value={`${hitRate}%`} />}
        </box>
    );
}

/**
 * Static detail behind the input bar's percentage - opened with ctrl+t or `/context` (see
 * input-bar.tsx and commands.tsx). Everything here is read-only and derived from state the
 * app already has: no new fetch, no estimate, nothing beyond what the provider has actually
 * reported.
 */
export function ContextOverlay() {
    const { colors } = useTheme();
    const { model } = useModel();
    const { messages } = useChat();

    const usage = contextUsage(messages, model);
    const lastMessage = latestUsageMessage(messages);
    const totals = sessionTotals(messages);

    if (usage === null || lastMessage === null) {
        return (
            <box flexDirection="column" gap={1}>
                <Row label="Model" value={`${model.id} · ${model.provider}`} />
                <text attributes={TextAttributes.DIM}>No usage recorded yet - send a message to see it here.</text>
            </box>
        );
    }

    const remaining = Math.max(0, usage.contextWindow - usage.usedTokens);
    // Same two thresholds as the footer's percentage (see input-bar.tsx), but the bar
    // always gets an explicit color rather than falling back to dim text below the warn
    // threshold - a graphic element with no fill color at all would just look broken.
    const percentColor = usage.percent >= 80 ? colors.error : usage.percent >= 50 ? colors.focus : colors.accent;

    return (
        <box flexDirection="column" gap={1}>
            <Row label="Model" value={`${model.id} · ${model.provider}`} />

            <box flexDirection="column">
                <text fg={percentColor}>{renderBar(usage.percent)} {Math.round(usage.percent)}%</text>
                <Row label="Used" value={`${formatTokenCount(usage.usedTokens)} / ${formatTokenCount(usage.contextWindow)}`} />
                <Row label="Remaining" value={formatTokenCount(remaining)} />
            </box>

            <LastTurnSection message={lastMessage} />

            <ToolOutputSection messages={messages} usedTokens={usage.usedTokens} />

            <SubagentSection messages={messages} />

            {/* Summed across every turn - unlike the fullness reading above, which is
                never a sum (see contextUsage's own comment on why). This is cost, not
                how full the window is. */}
            <box flexDirection="column">
                <SectionHeading>Session cost</SectionHeading>
                <Row label="Turns" value={String(totals.turns)} />
                <Row label="Total in" value={formatTokenCount(totals.inputTokens)} />
                <Row label="Total out" value={formatTokenCount(totals.outputTokens)} />
            </box>

            {lastMessage.projectInstructions !== undefined && (
                <Row
                    label={lastMessage.projectInstructions.filename}
                    value={`${formatBytes(lastMessage.projectInstructions.bytes)}${lastMessage.projectInstructions.truncated ? ' (cut)' : ''}`}
                />
            )}

            <text attributes={TextAttributes.DIM}>Reflects the last completed turn - your current draft isn't counted yet. Tool-output figures are estimated from characters, not counted.</text>
        </box>
    );
}
