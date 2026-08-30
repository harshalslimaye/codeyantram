import { useTheme } from '../providers/theme';
import { useChat } from '../providers/chat';
import { MessageList } from '../components/message-list';
import { InputBar } from '../components/input-bar';

export function Session() {
    const { colors } = useTheme();
    const { messages, isStreaming } = useChat();

    return (
        <box backgroundColor={colors.bg} flexGrow={1} flexDirection="column">
            <MessageList messages={messages} isStreaming={isStreaming} />
            <InputBar paddingBottom={1} />
        </box>
    );
}
