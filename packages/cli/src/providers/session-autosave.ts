import { useCallback, useRef, useState } from 'react';
import type { AgentName, AssistantMessage, EffortLevel, UserMessage } from '@codeyantram/shared';
import { appendMessage, createSession, resolveApproval } from '../api/sessions';
import { useToast } from './toast';

/**
 * Whatever ChatProvider knows about the turn a message belongs to, that this hook needs
 * but has no way to read itself. Passed explicitly by the caller rather than read via
 * useModel()/useAgent()/useEffort() internally, because the agent actually used for a
 * turn can differ from whatever those hooks currently return - sendMessage's own
 * agentOverride (see /init) means "what was selected" and "what this turn actually used"
 * are not always the same thing, and a saved session's modelId/agentName must reflect
 * the latter.
 */
export type SessionAutosaveContext = {
    project: string;
    // A bare string, not SupportedChatModelId: an OpenRouter model's id is fetched live
    // and never appears in the static catalog that type is derived from (see
    // modelsResponseSchema in @codeyantram/shared).
    modelId: string;
    agentName: AgentName;
    effort: EffortLevel | undefined;
};

export type SessionAutosave = {
    /** Null until the first message is actually saved - not set optimistically the
     * moment a save is requested, since the id doesn't exist until createSession's
     * response says so. */
    sessionId: string | null;
    /** The current session's title - server-derived on create (see createSession's
     * response), or handed over directly by resumeSession (attach) for one already
     * loaded. Null exactly when sessionId is, and for the same reason. */
    sessionTitle: string | null;
    /** Records a user message. If no session exists yet, this creates one with `message`
     * as its first (see createSession's own atomicity: a session row and its first
     * message are inserted together, so a session with zero messages never exists);
     * otherwise appends to the existing one. Fire-and-forget from the caller's
     * perspective - see the module comment on why. */
    saveUserMessage(message: UserMessage, context: SessionAutosaveContext): void;
    /** Records an assistant message - only ever called once a turn has fully finished
     * (chat.tsx's own "done" handling), carrying whatever usage it has, never mid-stream.
     * A failed no-op (reported like any other save failure - see below) if no session
     * exists yet. */
    saveAssistantMessage(message: AssistantMessage): void;
    /** Records an approval decision. Reported the same way as saveAssistantMessage if no
     * session exists yet. */
    saveApproval(toolCallId: string, approved: boolean): void;
    /** Detaches from whatever session is currently open - the next saveUserMessage
     * creates a brand new one instead of appending to the old one. Used by /new: the old
     * conversation is already durable (every message in it was saved as it happened), this
     * only moves the pointer. Queued through the same chain as every save (see below) for
     * why this can't just assign the ref directly. */
    reset(): void;
    /** Attaches to an already-existing session (its full history is whatever the caller -
     * a resume flow - already loaded and put in `messages`) so the next saveUserMessage
     * appends to it instead of creating a new one. Queued through the chain like reset,
     * for the same reason. `title` is the caller's own already-loaded Session.title - this
     * never re-derives or re-fetches it. */
    attach(sessionId: string, title: string): void;
    /** Updates sessionTitle locally, without making any network call - the caller has
     * already renamed the session via the API itself (see api/sessions.ts' renameSession);
     * this only applies if `sessionId` still matches the currently attached session. */
    renameCurrent(sessionId: string, title: string): void;
};

/**
 * The autosave mechanics chat.tsx delegates to, so ChatProvider's own body doesn't grow
 * by much wiring this in beyond three call sites. Kept as a plain hook (useRef/useState),
 * not a pure module like history.ts - unlike a keypress's state transition, what this
 * actually does is sequence async calls to the sessions API, which doesn't reduce to a
 * pure synchronous function the same way.
 *
 * Every save is fire-and-forget from the caller's side (none of the three methods return
 * a promise the caller awaits) - a slow or failed save must never delay or break the
 * live conversation, which already succeeded by the time any of these run.
 *
 * Calls are serialised through one promise chain (chainRef) rather than fired
 * independently, and this isn't an optional refinement - it's load-bearing for
 * correctness even for the ordinary case. A user message and the assistant reply that
 * follows it are two separate calls into this hook in quick succession; without
 * sequencing, the second (an append) could run before the first (a create) has resolved
 * and actually produced a session id to append to.
 */
export function useSessionAutosave(): SessionAutosave {
    const toast = useToast();
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [sessionTitle, setSessionTitle] = useState<string | null>(null);
    // Mirrors `sessionId` for synchronous reads inside enqueued tasks - a task reads this
    // ref, never the state variable, since the ref is guaranteed up to date the instant
    // the create task that set it finishes, while React state wouldn't necessarily have
    // committed yet by the time the very next enqueued task starts.
    const sessionIdRef = useRef<string | null>(null);
    const chainRef = useRef<Promise<void>>(Promise.resolve());
    // Fires the "not saved" toast once per unbroken streak of failures, not once per
    // failed save - the same "warn once, not every turn" reasoning chat.tsx's own
    // hasWarnedTruncationRef already uses for an oversized AGENTS.md. Reset the moment
    // any save actually succeeds, so a problem that resolves and later recurs (the
    // server restarts, then goes down again) gets its own fresh warning rather than
    // staying silenced for the rest of the process.
    const hasWarnedRef = useRef(false);

    const enqueue = useCallback(
        (task: () => Promise<void>) => {
            chainRef.current = chainRef.current
                .then(task)
                .then(() => {
                    hasWarnedRef.current = false;
                })
                .catch((error: unknown) => {
                    // Logged unconditionally (every failure, not just the first in a
                    // streak) - a permanent, scrollback-visible record for anyone
                    // debugging "why isn't this saving", independent of the toast below,
                    // which is deliberately throttled and ephemeral.
                    console.error('[sessions] autosave failed:', error);

                    if (hasWarnedRef.current) return;
                    hasWarnedRef.current = true;
                    // A background, best-effort concern, not a broken conversation - the
                    // turn itself already succeeded, so this is a warning, not an error,
                    // the same distinction chat.tsx draws between missing_credentials
                    // and every other chat failure.
                    toast.warn(`This session isn't being saved (${error instanceof Error ? error.message : String(error)}).`);
                });
        },
        [toast],
    );

    const saveUserMessage = useCallback(
        (message: UserMessage, context: SessionAutosaveContext) => {
            enqueue(async () => {
                if (sessionIdRef.current === null) {
                    const { id, title } = await createSession({
                        cwd: context.project,
                        model: context.modelId,
                        agent: context.agentName,
                        effort: context.effort,
                        firstMessage: message,
                    });
                    sessionIdRef.current = id;
                    setSessionId(id);
                    setSessionTitle(title);
                } else {
                    await appendMessage(sessionIdRef.current, message);
                }
            });
        },
        [enqueue],
    );

    const saveAssistantMessage = useCallback(
        (message: AssistantMessage) => {
            enqueue(async () => {
                if (sessionIdRef.current === null) {
                    // Only reachable if this turn's own saveUserMessage call already
                    // failed to create a session - by the time this runs, that earlier
                    // call has already fully settled (calls are serialised), so "still
                    // null" here can only mean "already failed", never "still pending".
                    // Thrown rather than silently skipped, so it flows through the same
                    // warn-once/log-always path above as any other save failure.
                    throw new Error("no session exists yet for this reply (its first message failed to save)");
                }
                await appendMessage(sessionIdRef.current, message);
            });
        },
        [enqueue],
    );

    const saveApproval = useCallback(
        (toolCallId: string, approved: boolean) => {
            enqueue(async () => {
                if (sessionIdRef.current === null) {
                    throw new Error("no session exists yet for this approval (its first message failed to save)");
                }
                await resolveApproval(sessionIdRef.current, toolCallId, approved);
            });
        },
        [enqueue],
    );

    // reset/attach both go through enqueue, the same as every save - not a direct ref
    // assignment - and that's load-bearing, not just consistency for its own sake. A plain
    // `sessionIdRef.current = null` here would race a create call already in flight (say,
    // the very message that /new is abandoning): if that create's own response lands
    // *after* this runs, its `.then` handler (see saveUserMessage above) would overwrite
    // the reset right back to the old session id, and the next message would silently
    // append to the conversation /new just left instead of starting a new one. Queuing
    // through the chain instead guarantees reset/attach only ever run once every
    // already-in-flight save for the previous session has fully settled.
    const reset = useCallback(() => {
        enqueue(async () => {
            sessionIdRef.current = null;
            setSessionId(null);
            setSessionTitle(null);
        });
    }, [enqueue]);

    const attach = useCallback(
        (id: string, title: string) => {
            enqueue(async () => {
                sessionIdRef.current = id;
                setSessionId(id);
                setSessionTitle(title);
            });
        },
        [enqueue],
    );

    // A local display update only - the caller (the session picker) has already made the
    // actual rename API call itself by the time this runs; this just keeps sessionTitle in
    // sync so a rename of the session currently open in chat shows up immediately in the
    // Session screen's header, instead of only after the next resume. Not queued through
    // enqueue like every save/reset/attach above: there's no network call here to
    // serialise against, and the `id` check guards the one real race that matters (a rename
    // for a session the user has since navigated away from, via /new or resuming another,
    // landing late and overwriting the *new* session's title).
    const renameCurrent = useCallback((id: string, title: string) => {
        if (sessionIdRef.current === id) setSessionTitle(title);
    }, []);

    return { sessionId, sessionTitle, saveUserMessage, saveAssistantMessage, saveApproval, reset, attach, renameCurrent };
}
