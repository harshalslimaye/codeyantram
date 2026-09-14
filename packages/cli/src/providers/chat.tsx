import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import {
    applyStreamEvent,
    effortLevelSchema,
    modelSupportsEffort,
    toRequestMessage,
    findSupportedChatModel,
    type AgentName,
    type AssistantMessage,
    type ChatMessage,
    type ChatRequest,
    type Session,
    type ToolCallPart,
} from '@codeyantram/shared';
import { AGENTS } from '../agents';
import { streamChat } from '../api/chat';
import { readPreferences, writePreferences } from '../utils/preferences';
import { useAgent } from './agent';
import { useModel } from './model';
import { useEffort } from './effort';
import { useSessionAutosave } from './session-autosave';
import { useToast } from './toast';

export type SendMessageOptions = {
    // Sends this turn as a different agent than the one currently selected,
    // without waiting for a setAgent() state update to land first - useful
    // for a command (e.g. /init) that both switches the agent and sends a
    // message in the same handler, where reading `agent.name` straight from
    // context would still see the pre-switch value (see sendMessage below).
    agent?: AgentName;
    // Fires once this turn's approval chain - however many tool-approval
    // round trips it takes - finally reaches a "done" with nothing left
    // pending, not on every intermediate "done" along the way, and not on
    // error or cancel (see the pendingOnDoneRef comment below). Lets a
    // command like /init confirm real completion without every ordinary
    // chat turn getting the same treatment.
    onDone?: () => void;
};

type ChatContextValue = {
    messages: ChatMessage[];
    isStreaming: boolean;
    sendMessage: (text: string, options?: SendMessageOptions) => void;
    cancel: () => void;
    newSession: () => void;
    /** Replaces the live conversation with an already-saved session's history (see
     * @codeyantram/sessions), reattaching autosave to it so the next message appends
     * rather than starting yet another session. Used by the session picker and by
     * --continue/--resume at launch. */
    resumeSession: (session: Session) => void;
    // The oldest tool call in the latest assistant message still awaiting a
    // decision - null once the turn is still streaming, or nothing is
    // pending. Only ever set for a mutating tool (see isReadOnlyTool).
    pendingApproval: ToolCallPart | null;
    respondToApproval: (approved: boolean) => void;
    // The off-switch for loading the project's AGENTS.md/CLAUDE.md, persisted
    // across restarts (see preferences.ts). Defaults to enabled.
    projectInstructionsEnabled: boolean;
    setProjectInstructionsEnabled: (enabled: boolean) => void;
    // The session currently being saved to (see useSessionAutosave) - null until the
    // first message of this conversation actually finishes saving. Exposed here for
    // Phase 5's picker, which needs to know which session is the one currently open.
    sessionId: string | null;
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
    const { model, setModel } = useModel();
    const { effort, setEffort } = useEffort();
    const { agent, setAgent } = useAgent();
    const toast = useToast();
    const autosave = useSessionAutosave();

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [projectInstructionsEnabled, setProjectInstructionsEnabledState] = useState(
        () => readPreferences().projectInstructionsEnabled ?? true,
    );

    // Mirrors `messages` synchronously so sendMessage/respondToApproval can
    // read the latest history (to build the next request) without depending
    // on - and being recreated by - `messages` itself.
    const messagesRef = useRef<ChatMessage[]>([]);
    const abortControllerRef = useRef<AbortController | null>(null);
    // Fires the truncation warning once per session rather than once per
    // turn - a large AGENTS.md doesn't shrink between messages, so repeating
    // it every turn would just be noise.
    const hasWarnedTruncationRef = useRef(false);
    // Set by sendMessage from its options.onDone (or cleared to null when none is given),
    // and left untouched by respondToApproval's own runTurn call - so it survives however
    // many approval round trips a single sendMessage-initiated chain takes, firing once the
    // chain finally reaches a "done" with no pending approval left, wherever in that chain
    // that turns out to be. Cleared without firing on "error" - that already gets its own
    // toast, and a completion toast on top of it would be misleading.
    const pendingOnDoneRef = useRef<(() => void) | null>(null);

    const setProjectInstructionsEnabled = useCallback((enabled: boolean) => {
        setProjectInstructionsEnabledState(enabled);
        writePreferences({ projectInstructionsEnabled: enabled });
    }, []);

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
    //
    // The old conversation isn't going anywhere - every message in it was already
    // autosaved as it happened (see Phase 4) - so this only clears what's on screen and
    // detaches autosave from it (autosave.reset()), so the next message starts a genuinely
    // new session instead of quietly appending to the one /new just left.
    const newSession = useCallback(() => {
        abortControllerRef.current?.abort();
        updateMessages(() => []);
        autosave.reset();
    }, [autosave.reset, updateMessages]);

    // Swaps the live conversation for an already-saved session's full history - the
    // session picker and --continue/--resume at launch both funnel through this. Model and
    // agent are restored when the catalog still recognizes them, falling back to whatever
    // is currently selected (with a toast) otherwise - the same graceful-degradation
    // sessionSummarySchema's own comment describes, since a session can easily outlive the
    // model/agent it was created with.
    //
    // Effort is set on a deferred tick (setTimeout 0), not in the same synchronous batch as
    // setModel - EffortProvider re-resolves its own effort from scratch, during render,
    // whenever the model prop it reads actually changes (see its own render-time
    // adjustment), and that resolution runs *after* whatever this function's own body does,
    // so a direct setEffort call here would get silently overwritten by it the instant the
    // model change lands. Deferring means EffortProvider's own re-resolution has already
    // happened and committed by the time this one runs, so it's this call, not that one,
    // that has the last word - the same "let the current render settle first" reasoning
    // overlay.tsx's own setTimeout(…, 1) already relies on for focus handoff.
    const resumeSession = useCallback(
        (session: Session) => {
            abortControllerRef.current?.abort();

            const resumedModel = findSupportedChatModel(session.modelId);
            if (resumedModel === undefined) {
                toast.warn(`"${session.modelId}" is no longer available - keeping ${model.id} for this session.`);
            } else {
                setModel(resumedModel);

                if (session.effort !== null) {
                    const parsedEffort = effortLevelSchema.safeParse(session.effort);
                    if (parsedEffort.success && modelSupportsEffort(resumedModel, parsedEffort.data)) {
                        setTimeout(() => setEffort(parsedEffort.data), 0);
                    }
                }
            }

            const resumedAgent = AGENTS.find(candidate => candidate.name === session.agentName);
            if (resumedAgent === undefined) {
                toast.warn(`"${session.agentName}" is no longer available - keeping ${agent.name} for this session.`);
            } else {
                setAgent(resumedAgent);
            }

            updateMessages(() => session.messages);
            autosave.attach(session.id);
        },
        [agent.name, autosave.attach, model.id, setAgent, setEffort, setModel, toast, updateMessages],
    );

    // The shared streaming core: sends `history` as-is (sendMessage appends
    // the new user message before calling this; respondToApproval doesn't
    // add one at all - it just replays the decision that's already in
    // `history`) and folds the response back into `messages` as it streams.
    const runTurn = useCallback(
        (history: ChatMessage[], agentOverride?: AgentName) => {
            // Single-flight: a turn already in progress must finish or be
            // cancelled before another can start.
            if (abortControllerRef.current !== null) return;

            const request: ChatRequest = {
                model: model.id,
                messages: history.map(toRequestMessage),
                agent: agentOverride ?? agent.name,
                cwd: process.cwd(),
                effort,
                useProjectInstructions: projectInstructionsEnabled,
            };

            const abortController = new AbortController();
            abortControllerRef.current = abortController;
            setIsStreaming(true);

            void (async () => {
                let assistantMessageId: string | null = null;
                // Tracked locally (plain JS, not React state) rather than derived from
                // `messages`/`messagesRef` at "done" time - setMessages' updater isn't
                // guaranteed to have actually run yet by the time a later event in this
                // same synchronous burst is processed, so a ref read right after queuing
                // an update can still see stale state. A toolCallId a "tool-result" can
                // never arrive for within the same turn (resolving it always takes a new
                // turn - see respondToApproval), so "any request without a same-turn
                // result" is exactly "still pending" for this turn's own purposes.
                const pendingApprovalIds = new Set<string>();

                try {
                    for await (const event of streamChat({ request, signal: abortController.signal })) {
                        switch (event.type) {
                            case 'start':
                                assistantMessageId = event.messageId;
                                updateMessages(current => [
                                    ...current,
                                    {
                                        id: event.messageId,
                                        role: 'assistant',
                                        parts: [],
                                        // Travels with the message it belongs to (like usage
                                        // below), rather than only reflecting whichever turn
                                        // is most recent - see message-list.tsx, which shows
                                        // it next to that message's own token usage.
                                        projectInstructions: event.projectInstructions,
                                    },
                                ]);
                                if (event.projectInstructions?.truncated && !hasWarnedTruncationRef.current) {
                                    hasWarnedTruncationRef.current = true;
                                    toast.warn(
                                        `${event.projectInstructions.filename} is larger than the limit and was cut off - see the file directly for the rest.`,
                                    );
                                }
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
                                if (event.type === 'tool-approval-request') pendingApprovalIds.add(event.toolCallId);
                                else pendingApprovalIds.delete(event.toolCallId);

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
                                // The error toast above is the completion signal here -
                                // don't also fire a queued onDone on top of it.
                                pendingOnDoneRef.current = null;

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
                                if (id === null) break;

                                if (event.usage !== undefined) {
                                    const usage = event.usage;
                                    updateMessages(current =>
                                        current.map(message =>
                                            message.id === id && message.role === 'assistant'
                                                ? { ...message, usage }
                                                : message,
                                        ),
                                    );
                                }

                                // Saved once, here, now that the message is actually
                                // finished (usage patched in above, if there was any) -
                                // never mid-stream. One assistant message exists per
                                // "start"..."done" round (see the "start" case above),
                                // so this fires once per round even mid-approval-chain,
                                // not only once the whole chain finally completes -
                                // each round's message is a real, distinct thing the
                                // store needs (a tool-call-only message with a pending
                                // approval is exactly what a resumed session replays).
                                // messagesRef.current, not `messages` - the updateMessages
                                // call just above has already synced it, and reading the
                                // ref rather than requiring a second render round-trip is
                                // exactly what messagesRef exists for.
                                const finishedMessage = messagesRef.current.find(
                                    (message): message is AssistantMessage => message.id === id && message.role === 'assistant',
                                );
                                if (finishedMessage !== undefined) autosave.saveAssistantMessage(finishedMessage);

                                if (pendingApprovalIds.size === 0) {
                                    const onDone = pendingOnDoneRef.current;
                                    pendingOnDoneRef.current = null;
                                    onDone?.();
                                }
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
        // autosave.saveAssistantMessage specifically, not the whole `autosave` object -
        // useSessionAutosave returns a fresh object literal every render (only its
        // individual methods are memoized via useCallback), so depending on the object
        // itself would recreate runTurn - and everything downstream of it - on every
        // single render, defeating every useCallback in this file.
        [agent.name, autosave.saveAssistantMessage, model.id, effort, projectInstructionsEnabled, toast, updateMessages],
    );

    const sendMessage = useCallback(
        (text: string, options?: SendMessageOptions) => {
            const trimmed = text.trim();
            if (trimmed === '' || abortControllerRef.current !== null) return;

            // Not annotated `: ChatMessage` - left to infer its own literal type so it
            // narrows to UserMessage, which autosave.saveUserMessage below requires.
            const userMessage = {
                id: crypto.randomUUID(),
                role: 'user' as const,
                parts: [{ type: 'text' as const, text: trimmed }],
            };

            const history = [...messagesRef.current, userMessage];
            updateMessages(() => history);
            // The agent actually used for this turn - options?.agent can override the
            // currently-selected one (see SendMessageOptions), and the saved session's
            // agentName has to reflect that, not whatever agent.name happens to be.
            autosave.saveUserMessage(userMessage, {
                project: process.cwd(),
                modelId: model.id,
                agentName: options?.agent ?? agent.name,
                effort,
            });
            // Always (re)assigned here, including to null - so a plain message sent after
            // an earlier onDone-bearing chain never inherits a stale callback (see the
            // pendingOnDoneRef comment above for why respondToApproval's own runTurn call
            // must NOT do this same reassignment).
            pendingOnDoneRef.current = options?.onDone ?? null;
            runTurn(history, options?.agent);
        },
        [agent.name, autosave.saveUserMessage, effort, model.id, runTurn, updateMessages],
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
            autosave.saveApproval(pending.toolCallId, approved);

            if (findPendingApproval(updatedMessage) === null) runTurn(updatedHistory);
        },
        [autosave.saveApproval, runTurn, updateMessages],
    );

    const pendingApproval = isStreaming ? null : findPendingApproval(messages[messages.length - 1]);

    return (
        <ChatContext.Provider
            value={{
                messages,
                isStreaming,
                sendMessage,
                cancel,
                newSession,
                resumeSession,
                pendingApproval,
                respondToApproval,
                projectInstructionsEnabled,
                setProjectInstructionsEnabled,
                sessionId: autosave.sessionId,
            }}
        >
            {children}
        </ChatContext.Provider>
    );
}
