import { TextAttributes } from '@opentui/core';
import { useTheme } from '../providers/theme';
import { useChat } from '../providers/chat';
import { MessageList } from '../components/message-list';
import { InputBar } from '../components/input-bar';
import { Spinner } from '../components/spinner';
import { truncate } from '../utils/format';

const MAX_HEADER_TITLE_LENGTH = 70;

export function Session() {
    const { colors } = useTheme();
    const { messages, isStreaming, sessionTitle } = useChat();

    // Once the assistant message arrives it always carries at least one part
    // before its first render (see ChatProvider's text-delta/tool-call
    // handling), so an empty last message means the request is still in
    // flight with nothing yet to show in MessageList.
    const lastMessage = messages[messages.length - 1];
    const isWaitingForResponse =
        isStreaming && (lastMessage === undefined || lastMessage.role === 'user' || lastMessage.parts.length === 0);

    return (
        <box backgroundColor={colors.bg} flexGrow={1} flexDirection="column">
            <box paddingX={2} paddingTop={1}>
                {/* Null for the brief window between sending the first message and
                    autosave's create call actually finishing (see useSessionAutosave) -
                    "New session" covers that gap rather than showing nothing at all. */}
                <text attributes={TextAttributes.DIM}>{truncate(sessionTitle ?? 'New session', MAX_HEADER_TITLE_LENGTH)}</text>
            </box>
            <MessageList messages={messages} isStreaming={isStreaming} />
            {isWaitingForResponse && (
                <box paddingX={2} paddingBottom={1}>
                    <Spinner />
                </box>
            )}
            <box padding={1}>
                <InputBar paddingBottom={1} />
            </box>
        </box>
    );
}
