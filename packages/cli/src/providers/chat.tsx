import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import {
    applyStreamEvent,
    toRequestMessage,
    type ChatMessage,
    type ChatRequest,
    type ToolCallPart,
} from '@codeyantram/shared';
import { streamChat } from '../api/chat';
import { useAgent } from './agent';
import { useModel } from './model';
import { useEffort } from './effort';
import { useToast } from './toast';

type ChatContextValue = {
    messages: ChatMessage[];
    isStreaming: boolean;
    sendMessage: (text: string) => void;
    cancel: () => void;
    newSession: () => void;
    // The oldest tool call in the latest assistant message still awaiting a
    // decision - null once the turn is still streaming, or nothing is
    // pending. Only ever set for a mutating tool (see isReadOnlyTool).
    pendingApproval: ToolCallPart | null;
    respondToApproval: (approved: boolean) => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
    const context = useContext(ChatContext);
    if (!context) {
        throw new Error('useChat must be used within a ChatProvider');
    }
    return context;
}

type ChatProviderProps = {
    children: ReactNode;
};

function findPendingApproval(message: ChatMessage | undefined): ToolCallPart | null {
    if (message === undefined || message.role !== 'assistant') return null;

    return (
        message.parts.find(
            (part): part is ToolCallPart => part.type === 'tool-call' && part.approvalStatus === 'pending',
        ) ?? null
    );
}

export function ChatProvider({ children }: ChatProviderProps) {
    const { model } = useModel();
    const { effort } = useEffort();
    const { agent } = useAgent();
    const toast = useToast();

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);

    // Mirrors `messages` synchronously so sendMessage/respondToApproval can
    // read the latest history (to build the next request) without depending
    // on - and being recreated by - `messages` itself.
    const messagesRef = useRef<ChatMessage[]>([]);
    const abortControllerRef = useRef<AbortController | null>(null);

    const updateMessages = useCallback((updater: (current: ChatMessage[]) => ChatMessage[]) => {
        setMessages(current => {
            const next = updater(current);
            messagesRef.current = next;
            return next;
        });
    }, []);

    const cancel = useCallback(() => {
        abortControllerRef.current?.abort();
    }, []);

    // Cancels any in-flight turn first, so a late-arriving delta for the
    // conversation being discarded has nothing left to attach to.
    const newSession = useCallback(() => {
        abortControllerRef.current?.abort();
        updateMessages(() => []);
    }, [updateMessages]);

    // The shared streaming core: sends `history` as-is (sendMessage appends
    // the new user message before calling this; respondToApproval doesn't
    // add one at all - it just replays the decision that's already in
    // `history`) and folds the response back into `messages` as it streams.
    const runTurn = useCallback(
        (history: ChatMessage[]) => {
            // Single-flight: a turn already in progress must finish or be
            // cancelled before another can start.
            if (abortControllerRef.current !== null) return;

            const request: ChatRequest = {
                model: model.id,
                messages: history.map(toRequestMessage),
                agent: agent.name,
                cwd: process.cwd(),
                effort,
            };

            const abortController = new AbortController();
            abortControllerRef.current = abortController;
            setIsStreaming(true);

            void (async () => {
                let assistantMessageId: string | null = null;

                try {
                    for await (const event of streamChat({ request, signal: abortController.signal })) {
                        switch (event.type) {
                            case 'start':
                                assistantMessageId = event.messageId;
                                updateMessages(current => [
                                    ...current,
                                    { id: event.messageId, role: 'assistant', parts: [] },
                                ]);
                                break;

                            case 'text-delta':
                            case 'reasoning-delta':
                            case 'tool-call': {
                                const id = assistantMessageId;
                                if (id === null) break;
                                updateMessages(current =>
                                    current.map(message =>
                                        message.id === id && message.role === 'assistant'
                                            ? { ...message, parts: applyStreamEvent(message.parts, event) }
                                            : message,
                                    ),
                                );
                                break;
                            }

                            // Resolved by toolCallId rather than the current
                            // message id: after an approval round-trip, the
                            // eventual "tool-result" for a call arrives in a
                            // later turn's stream (a new assistant message),
                            // but the tool-call it belongs to lives in an
                            // earlier one.
                            case 'tool-result':
                            case 'tool-approval-request':
                                updateMessages(current =>
                                    current.map(message =>
                                        message.role === 'assistant' &&
                                        message.parts.some(
                                            part => part.type === 'tool-call' && part.toolCallId === event.toolCallId,
                                        )
                                            ? { ...message, parts: applyStreamEvent(message.parts, event) }
                                            : message,
                                    ),
                                );
                                break;

                            case 'error': {
                                const notify = event.code === 'missing_credentials' ? toast.warn : toast.error;
                                notify(event.message);

                                // A turn that failed before any content arrived leaves
                                // nothing worth showing - drop the empty assistant bubble
                                // rather than rendering a blank message.
                                const id = assistantMessageId;
                                if (id !== null) {
                                    updateMessages(current =>
                                        current.filter(
                                            message =>
                                                !(
                                                    message.id === id &&
                                                    message.role === 'assistant' &&
                                                    message.parts.length === 0
                                                ),
                                        ),
                                    );
                                }
                                break;
                            }

                            case 'done': {
                                const id = assistantMessageId;
                                if (id === null || event.usage === undefined) break;
                                const usage = event.usage;
                                updateMessages(current =>
                                    current.map(message =>
                                        message.id === id && message.role === 'assistant'
                                            ? { ...message, usage }
                                            : message,
                                    ),
                                );
                                break;
                            }
                        }
                    }
                } finally {
                    abortControllerRef.current = null;
                    setIsStreaming(false);
                }
            })();
        },
        [agent.name, model.id, effort, toast, updateMessages],
    );

    const sendMessage = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (trimmed === '' || abortControllerRef.current !== null) return;

            const userMessage: ChatMessage = {
                id: crypto.randomUUID(),
                role: 'user',
                parts: [{ type: 'text', text: trimmed }],
            };

            const history = [...messagesRef.current, userMessage];
            updateMessages(() => history);
            runTurn(history);
        },
        [runTurn, updateMessages],
    );

    // Records the user's decision on the oldest pending approval in the
    // latest assistant message, then - once none remain in that message -
    // automatically starts a new turn so the server can act on it. No new
    // user message is appended; the decision itself is what moves things
    // forward (see toModelMessages/toolPartsToMessages on the server, which
    // replay it as a "tool-approval-response").
    const respondToApproval = useCallback(
        (approved: boolean) => {
            const current = messagesRef.current;
            const lastMessage = current[current.length - 1];
            if (lastMessage === undefined || lastMessage.role !== 'assistant') return;

            const pending = findPendingApproval(lastMessage);
            if (!pending) return;

            const updatedMessage: ChatMessage = {
                ...lastMessage,
                parts: lastMessage.parts.map(part =>
                    part === pending
                        ? { ...part, approvalStatus: approved ? ('approved' as const) : ('denied' as const) }
                        : part,
                ),
            };
            const updatedHistory = [...current.slice(0, -1), updatedMessage];
            updateMessages(() => updatedHistory);

            if (findPendingApproval(updatedMessage) === null) runTurn(updatedHistory);
        },
        [runTurn, updateMessages],
    );

    const pendingApproval = isStreaming ? null : findPendingApproval(messages[messages.length - 1]);

    return (
        <ChatContext.Provider
            value={{ messages, isStreaming, sendMessage, cancel, newSession, pendingApproval, respondToApproval }}
        >
            {children}
        </ChatContext.Provider>
    );
}
