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

            <text attributes={TextAttributes.DIM}>Reflects the last completed turn - your current draft isn't counted yet.</text>
        </box>
    );
}
