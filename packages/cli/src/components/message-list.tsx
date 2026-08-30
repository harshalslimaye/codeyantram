import { TextAttributes } from '@opentui/core';
import type { ChatMessage, MessagePart } from '@codeyantram/shared';
import { useTheme } from '../providers/theme';

function MessagePartView({ part }: { part: MessagePart }) {
    switch (part.type) {
        case 'text':
            return <text wrapMode="word">{part.text}</text>;

        case 'reasoning':
            return (
                <text wrapMode="word" attributes={TextAttributes.DIM}>
                    {part.text}
                </text>
            );

        // No tool loop exists yet - this keeps a tool-call part from crashing
        // the transcript the moment one shows up, nothing more polished yet.
        case 'tool-call':
            return (
                <text attributes={TextAttributes.DIM}>
                    {`→ ${part.toolName}${part.result !== undefined ? ' (done)' : '...'}`}
                </text>
            );
    }
}

function MessageRow({ message }: { message: ChatMessage }) {
    const { colors } = useTheme();
    const isUser = message.role === 'user';

    return (
        <box flexDirection="column" marginBottom={1}>
            <text fg={isUser ? colors.text : colors.accent} attributes={TextAttributes.DIM}>
                {isUser ? 'you' : 'assistant'}
            </text>
            <box flexDirection="column">
                {message.parts.length === 0 ? (
                    <text attributes={TextAttributes.DIM}>…</text>
                ) : (
                    message.parts.map((part, index) => <MessagePartView key={index} part={part} />)
                )}
            </box>
        </box>
    );
}

type MessageListProps = {
    messages: ChatMessage[];
};

/**
 * The chat transcript. stickyStart="bottom" keeps it pinned to the latest
 * content as deltas stream in, while still letting the user scroll up to
 * read earlier turns without fighting the auto-scroll.
 */
export function MessageList({ messages }: MessageListProps) {
    const { colors } = useTheme();

    return (
        <scrollbox flexGrow={1} stickyScroll stickyStart="bottom" backgroundColor={colors.bg}>
            <box flexDirection="column" paddingX={2} paddingY={1}>
                {messages.map(message => (
                    <MessageRow key={message.id} message={message} />
                ))}
            </box>
        </scrollbox>
    );
}
