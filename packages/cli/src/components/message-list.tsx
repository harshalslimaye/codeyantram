import { TextAttributes, type SyntaxStyle, type TreeSitterClient } from '@opentui/core';
import type { ChatMessage, MessagePart } from '@codeyantram/shared';
import { useTheme } from '../providers/theme';
import { getAppTreeSitterClient } from '../tree-sitter-client';
import type { ThemeColors } from '../theme';

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
            return (
                <box flexDirection="column">
                    <text fg={colors.focus} attributes={TextAttributes.DIM}>Thought</text>
                    <text wrapMode="word" attributes={TextAttributes.DIM}>{part.text}</text>
                </box>
            );

        case 'tool-call':
            return (
                <box flexDirection="row" gap={1}>
                    <text fg={colors.accent}>■</text>
                    <text attributes={TextAttributes.BOLD}>{part.toolName}</text>
                    <text attributes={TextAttributes.DIM}>{part.result !== undefined ? 'done' : 'running…'}</text>
                </box>
            );
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
        <box flexDirection="row">
            <box padding={1} backgroundColor={colors.panel} flexGrow={1}>
                <text>$ {message} </text>
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
