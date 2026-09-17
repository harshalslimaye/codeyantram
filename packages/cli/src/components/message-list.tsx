import { useEffect, useState } from 'react';
import { TextAttributes, type SyntaxStyle, type TreeSitterClient } from '@opentui/core';
import type { AssistantMessage, ChatMessage, MessagePart, TokenUsage, ToolCallPart } from '@codeyantram/shared';
import { useTheme } from '../providers/theme';
import { Spinner } from './spinner';
import { getAppTreeSitterClient } from '../tree-sitter-client';
import type { ThemeColors } from '../theme';
import { formatTokenCount } from '../utils/format';

function formatBytes(bytes: number): string {
    return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
}

/** The prompt-cache half of a turn's input tokens, as a parenthetical on the "in" count
 * rather than segments of its own - `inputTokens` already includes both, so these break
 * that number down instead of adding to it. Empty when the provider reported no cache
 * activity, which is also what a cold first turn looks like; a session where this stays
 * empty turn after turn means the prefix isn't caching. */
function cacheSummary(usage: TokenUsage): string {
    const notes: string[] = [];

    if (usage.cacheReadTokens) notes.push(`${formatTokenCount(usage.cacheReadTokens)} cached`);
    if (usage.cacheWriteTokens) notes.push(`+${formatTokenCount(usage.cacheWriteTokens)} write`);

    return notes.length > 0 ? ` (${notes.join(', ')})` : '';
}

/** Per-turn cost summary: token usage and, when that turn's own AGENTS.md/CLAUDE.md rode
 * along, its size - both travel with the message they belong to (see chat.tsx's "start"
 * and "done" handling), so this always reflects that specific turn, not just the latest. */
function usageSummary(message: AssistantMessage): string | null {
    const parts: string[] = [];

    if (message.usage?.inputTokens !== undefined) {
        parts.push(`${formatTokenCount(message.usage.inputTokens)} in${cacheSummary(message.usage)}`);
    }
    if (message.usage?.outputTokens !== undefined) parts.push(`${formatTokenCount(message.usage.outputTokens)} out`);

    // Worker spend, deliberately reported separately from the `in`/`out` above rather
    // than summed into them: those are what this turn's prompt cost, and worker tokens
    // never entered this turn's context window at all. They are still real money, which
    // is the whole reason to show them - without this line a turn that spent 40k tokens
    // on three workers looks identical to one that spent none.
    if (message.subagents !== undefined) {
        const { count, inputTokens, outputTokens } = message.subagents;
        const worker = count === 1 ? 'worker' : 'workers';
        parts.push(`${count} ${worker} ${formatTokenCount(inputTokens + outputTokens)}`);
    }

    if (message.projectInstructions !== undefined) {
        const { filename, bytes, truncated } = message.projectInstructions;
        parts.push(`${filename} ${formatBytes(bytes)}${truncated ? ' (cut)' : ''}`);
    }

    return parts.length > 0 ? parts.join(' · ') : null;
}

function toolStatusLabel(part: ToolCallPart): string {
    if (part.result !== undefined) return 'done';
    if (part.approvalStatus === 'pending') return 'needs approval';
    if (part.approvalStatus === 'denied') return 'denied';
    return 'running…';
}

function stringArg(args: ToolCallPart['args'], key: string): string | null {
    const value = args[key];
    return typeof value === 'string' ? value : null;
}

/** A one-line summary of what a tool call is actually doing - the path, pattern, or command - rather than making the reader open the result to find out. */
function toolArgsSummary(part: ToolCallPart): string | null {
    const args = part.args;

    switch (part.toolName) {
        case 'read_file': {
            const path = stringArg(args, 'path');
            if (path === null) return null;

            // Only worth showing when the model asked for a window - a plain whole-file
            // read is the common case and doesn't need "(from line 1)" hung off it.
            const offset = typeof args.offset === 'number' ? args.offset : null;
            const limit = typeof args.limit === 'number' ? args.limit : null;
            if (offset === null && limit === null) return path;

            const from = offset ?? 1;
            return limit === null ? `${path} (from line ${from})` : `${path} (lines ${from}-${from + limit - 1})`;
        }

        case 'list_dir':
        case 'undo_edit':
            return stringArg(args, 'path');

        case 'write_file': {
            const path = stringArg(args, 'path');
            if (path === null) return null;

            // A dry run writes nothing and a base64 write isn't text - both change what
            // approving this call actually does, so neither should be read off the path alone.
            const notes = [args.dryRun === true ? 'dry run' : null, args.encoding === 'base64' ? 'base64' : null].filter(note => note !== null);
            return notes.length > 0 ? `${path} (${notes.join(', ')})` : path;
        }

        case 'edit_file': {
            const path = stringArg(args, 'path');
            if (path === null) return null;
            const edits = args.edits;
            const editCount = Array.isArray(edits) ? edits.length : 1;
            return editCount > 1 ? `${path} (${editCount} edits)` : path;
        }

        case 'glob':
            return stringArg(args, 'pattern');

        case 'grep': {
            const pattern = stringArg(args, 'pattern');
            const path = stringArg(args, 'path');
            if (pattern === null) return null;
            return path !== null && path !== '.' ? `${pattern} in ${path}` : pattern;
        }

        case 'bash':
            return stringArg(args, 'command');

        case 'git': {
            const command = stringArg(args, 'command');
            if (command === null) return null;

            // Shown the way it would be typed - `git log -n 5 --oneline` - rather than as
            // the subcommand alone, since the arguments are what say whether this is one
            // commit or the whole history.
            const gitArgs = Array.isArray(args.args) ? args.args.filter((arg): arg is string => typeof arg === 'string') : [];
            return [`git ${command}`, ...gitArgs].join(' ');
        }

        case 'web_fetch': {
            const url = stringArg(args, 'url');
            if (url === null) return null;

            // Host + path is what tells a reader where this is actually going; the
            // query string is often long and rarely the interesting part.
            let display: string;
            try {
                const parsed = new URL(url);
                display = `${parsed.host}${parsed.pathname}`;
            } catch {
                display = url;
            }

            const MAX_DISPLAY_LENGTH = 60;
            if (display.length > MAX_DISPLAY_LENGTH) display = `${display.slice(0, MAX_DISPLAY_LENGTH - 1)}…`;

            const offset = typeof args.offset === 'number' ? args.offset : null;
            const limit = typeof args.limit === 'number' ? args.limit : null;
            const pagingNote = offset === null && limit === null ? null : limit === null ? `from line ${offset ?? 1}` : `lines ${offset ?? 1}-${(offset ?? 1) + limit - 1}`;

            const notes = [pagingNote, args.refresh === true ? 'refresh' : null].filter((note): note is string => note !== null);
            return notes.length > 0 ? `${display} (${notes.join(', ')})` : display;
        }

        case 'explore': {
            const task = stringArg(args, 'task');
            if (task === null) return null;

            // The whole point of showing this: the turn goes silent for five to fifteen
            // seconds while the worker runs, and this line is the only thing saying what
            // is being looked for.
            const MAX_DISPLAY_LENGTH = 70;
            return task.length > MAX_DISPLAY_LENGTH ? `${task.slice(0, MAX_DISPLAY_LENGTH - 1)}…` : task;
        }

        default:
            return null;
    }
}

/** Tools slow enough that a static "running…" reads as hung rather than working. Every
 * other tool finishes in milliseconds, so its label is never on screen long enough to
 * matter; a subagent runs a whole model loop of its own. */
function isSlowTool(name: string): boolean {
    return name === 'explore';
}

/**
 * Whether a finished call's own result is worth printing under it.
 *
 * Almost never: a grep's hundred matches or a five-hundred-line read would bury the
 * conversation, which is why no tool has ever rendered its output here. A subagent's
 * answer is the exception, and for the same reason it exists - it is a handful of cited
 * lines, bounded by MAX_SUBAGENT_OUTPUT_CHARS, and it is the only place those citations
 * ever appear. Hiding it would leave the user watching a spinner for fifteen seconds and
 * then reading a paraphrase of what the worker already said.
 */
function showsResult(part: ToolCallPart): boolean {
    return part.result !== undefined && part.result !== '' && isSlowTool(part.toolName);
}

/** Seconds since mount, ticking once a second. Only rendered for a call still in flight,
 * so the interval lives exactly as long as the call does. */
function useElapsedSeconds(): number {
    const [seconds, setSeconds] = useState(0);

    useEffect(() => {
        const startedAt = Date.now();
        const id = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
        return () => clearInterval(id);
    }, []);

    return seconds;
}

/**
 * The running state of a slow tool call: a spinner and an elapsed count.
 *
 * Its own component so the once-a-second re-render stays scoped to this line rather than
 * repainting the whole message list, and so the interval is mounted only while a call is
 * actually in flight - React unmounts this the moment the result arrives.
 *
 * A spinner alone doesn't distinguish "working" from "stuck" on a wait this long, which is
 * what the seconds are for. There is nothing more specific to show: the worker deliberately
 * doesn't stream, so the CLI knows only that it is alive, not what it is doing.
 */
function RunningToolLabel() {
    const elapsed = useElapsedSeconds();

    // Spinner runs its own frame interval, so the animation doesn't depend on this
    // component re-rendering - which it only does once a second, for the count.
    return <Spinner label={elapsed > 0 ? `running… ${elapsed}s` : 'running…'} />;
}

function MessagePartView({
    part,
    colors,
    syntaxStyle,
    treeSitterClient,
    streaming,
    isUser,
}: {
    part: MessagePart,
    colors: ThemeColors,
    syntaxStyle: SyntaxStyle,
    treeSitterClient: TreeSitterClient,
    streaming: boolean,
    isUser: boolean,
}) {
    switch (part.type) {
        case 'text':
            return isUser
                ? <UserMessage message={part.text} colors={colors} />
                : (
                    <markdown
                        content={part.text}
                        syntaxStyle={syntaxStyle}
                        treeSitterClient={treeSitterClient}
                        streaming={streaming}
                        conceal
                    />
                );

        case 'reasoning':
            if (part.text === '') return null;
            return (
                <box flexDirection="column">
                    <text attributes={TextAttributes.DIM}>Thought</text>
                    <text wrapMode="word" attributes={TextAttributes.DIM}>{part.text}</text>
                </box>
            );

        case 'tool-call': {
            const argsSummary = toolArgsSummary(part);
            // Animated only while a slow call is genuinely unresolved - a finished call
            // renders its plain label, and every other tool is far too quick for the
            // difference to be visible.
            const isRunningSlowly = part.result === undefined && part.approvalStatus === undefined && isSlowTool(part.toolName);

            return (
                <box flexDirection="column">
                    <box flexDirection="row" gap={1}>
                        <text fg={colors.accent}>■</text>
                        <text attributes={TextAttributes.BOLD}>{part.toolName}</text>
                        {isRunningSlowly ? <RunningToolLabel /> : <text attributes={TextAttributes.DIM}>{toolStatusLabel(part)}</text>}
                    </box>
                    {argsSummary !== null && (
                        <text wrapMode="word" attributes={TextAttributes.DIM}>
                            {argsSummary}
                        </text>
                    )}
                    {showsResult(part) && (
                        <text wrapMode="word" attributes={TextAttributes.DIM}>
                            {part.result}
                        </text>
                    )}
                </box>
            );
        }
    }
}

// No `padding` (or `border`, which behaves the same way here) on either box -
// nested inside <scrollbox>'s content, either one defeats the scrollbox's own
// flex-clipping (see MessageList's minHeight comment) and pushes InputBar
// off-screen entirely, regardless of message count - confirmed this is
// specifically padding/border, not depth or repetition: `margin` is unaffected.
// The accent bar is a fixed-width background fill rather than a left border for
// the same reason, and the leading/trailing space fakes padding's inset
// visually without using it.
function UserMessage({ message, colors }: { message: string, colors: ThemeColors }) {
    return (
        <box border={['left']} borderColor={colors.accent} flexDirection="row">
            <box padding={1} backgroundColor={colors.panel} flexGrow={1}>
                <text>{message} </text>
            </box>
        </box>
    )
}

function MessageRow({
    message,
    colors,
    syntaxStyle,
    treeSitterClient,
    streaming,
}: {
    message: ChatMessage,
    colors: ThemeColors,
    syntaxStyle: SyntaxStyle,
    treeSitterClient: TreeSitterClient,
    streaming: boolean,
}) {
    const isUser = message.role === 'user';
    const usage = message.role === 'assistant' ? usageSummary(message) : null;

    return (
        <box flexDirection="column" marginBottom={1}>
            <box flexDirection="column">
                {message.parts.length === 0 ? (
                    <text attributes={TextAttributes.DIM}>…</text>
                ) : (
                    message.parts.map((part, index) =>
                        <MessagePartView
                            key={index}
                            part={part}
                            colors={colors}
                            syntaxStyle={syntaxStyle}
                            treeSitterClient={treeSitterClient}
                            streaming={streaming}
                            isUser={isUser}
                        />
                    )
                )}
            </box>
            {usage !== null && (
                <text paddingTop={1} attributes={TextAttributes.DIM}>{usage}</text>
            )}
        </box>
    );
}

type MessageListProps = {
    messages: ChatMessage[];
    // Only the last message can still be streaming - a single-flight turn
    // (see ChatProvider.sendMessage) never lets an earlier one still be open.
    isStreaming?: boolean;
    // Overridable so tests can inject a MockTreeSitterClient instead of
    // spinning up the real WASM worker - production always uses the default.
    treeSitterClient?: TreeSitterClient;
};

/**
 * The chat transcript. stickyStart="bottom" keeps it pinned to the latest
 * content as deltas stream in, while still letting the user scroll up to
 * read earlier turns without fighting the auto-scroll.
 */
export function MessageList({ messages, isStreaming = false, treeSitterClient = getAppTreeSitterClient() }: MessageListProps) {
    const { colors, syntaxStyle } = useTheme();
    const lastMessageId = messages[messages.length - 1]?.id;

    // flexGrow alone defaults to flexBasis="auto", which uses the scrollbox's
    // *content* size (everything in the transcript) as its starting size
    // before growing - with long, word-wrapped assistant text this measures
    // taller than the terminal, so the scrollbox (and InputBar below it) get
    // pushed off-screen instead of the scrollbox clipping/scrolling within
    // its allotted space. flexBasis={0} + minHeight={0} is the standard fix:
    // start from zero and let flexGrow do all the sizing, matching CSS's
    // `flex: 1 1 0` idiom for exactly this "flex child with overflowing
    // content" case.
    return (
        <scrollbox flexGrow={1} flexBasis={0} minHeight={0} stickyScroll stickyStart="bottom" backgroundColor={colors.bg}>
            <box flexDirection="column" paddingX={2} paddingY={1}>
                {messages.map(message => (
                    <MessageRow
                        key={message.id}
                        message={message}
                        colors={colors}
                        syntaxStyle={syntaxStyle}
                        treeSitterClient={treeSitterClient}
                        streaming={isStreaming && message.id === lastMessageId}
                    />
                ))}
            </box>
        </scrollbox>
    );
}
