import { TextAttributes, type SyntaxStyle, type TreeSitterClient } from '@opentui/core';
import type { ChatMessage, MessagePart, ToolCallPart, TokenUsage } from '@codeyantram/shared';
import { useTheme } from '../providers/theme';
import { getAppTreeSitterClient } from '../tree-sitter-client';
import type { ThemeColors } from '../theme';

function formatTokenCount(count: number): string {
    return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

function usageSummary(usage: TokenUsage | undefined): string | null {
    if (usage === undefined) return null;

    const { inputTokens, outputTokens } = usage;
    if (inputTokens === undefined && outputTokens === undefined) return null;

    const parts: string[] = [];
    if (inputTokens !== undefined) parts.push(`${formatTokenCount(inputTokens)} in`);
    if (outputTokens !== undefined) parts.push(`${formatTokenCount(outputTokens)} out`);
    return parts.join(' · ');
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

        default:
            return null;
    }
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
            return (
                <box flexDirection="column">
                    <box flexDirection="row" gap={1}>
                        <text fg={colors.accent}>■</text>
                        <text attributes={TextAttributes.BOLD}>{part.toolName}</text>
                        <text attributes={TextAttributes.DIM}>{toolStatusLabel(part)}</text>
                    </box>
                    {argsSummary !== null && (
                        <text wrapMode="word" attributes={TextAttributes.DIM}>
                            {argsSummary}
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
    const usage = message.role === 'assistant' ? usageSummary(message.usage) : null;

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
