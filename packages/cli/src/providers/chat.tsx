import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import {
    applyStreamEvent,
    toRequestMessage,
    type ChatMessage,
    type ChatRequest,
} from '@codeyantram/shared';
import { streamChat } from '../api/chat';
import { useModel } from './model';
import { useToast } from './toast';

type ChatContextValue = {
    messages: ChatMessage[];
    isStreaming: boolean;
    sendMessage: (text: string) => void;
    cancel: () => void;
    newSession: () => void;
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

export function ChatProvider({ children }: ChatProviderProps) {
    const { model } = useModel();
    const toast = useToast();

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);

    // Mirrors `messages` synchronously so sendMessage can read the latest
    // history (to build the request) without depending on - and being
    // recreated by - `messages` itself.
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

    const sendMessage = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            // Single-flight: a turn already in progress must finish or be
            // cancelled before another can start.
            if (trimmed === '' || abortControllerRef.current !== null) return;

            const userMessage: ChatMessage = {
                id: crypto.randomUUID(),
                role: 'user',
                parts: [{ type: 'text', text: trimmed }],
            };

            const history = [...messagesRef.current, userMessage];
            updateMessages(() => history);

            const request: ChatRequest = {
                model: model.id,
                messages: history.map(toRequestMessage),
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
                            case 'tool-call':
                            case 'tool-result': {
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

                            case 'done':
                                break;
                        }
                    }
                } finally {
                    abortControllerRef.current = null;
                    setIsStreaming(false);
                }
            })();
        },
        [model.id, toast, updateMessages],
    );

    return (
        <ChatContext.Provider value={{ messages, isStreaming, sendMessage, cancel, newSession }}>
            {children}
        </ChatContext.Provider>
    );
}
