import { useEffect, useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { TextAttributes } from '@opentui/core';
import type { SessionSummary } from '@codeyantram/shared';
import { deleteSession, listSessions, loadSession, renameSession } from '../api/sessions';
import { useChat } from '../providers/chat';
import { useOverlay } from '../providers/overlay';
import { useToast } from '../providers/toast';
import { useLayerStack } from '../providers/keyboard';
import { formatRelativeTime, truncate } from '../utils/format';
import { prefixFilter } from '../utils/filter';
import { OverlayList } from './overlay-list';

type LoadState =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; sessions: SessionSummary[] };

// OverlayList's row is a single-line flex row with the message-count/age column pinned to
// the right - a title long enough to wrap collides with that column instead of pushing it
// down (see the renderer below). Filtering still matches against the full title
// (prefixFilter below reads `session.title` directly, not this truncated copy).
const MAX_TITLE_LENGTH = 40;

type SessionRenameFormProps = {
    session: SessionSummary;
    onRenamed: (title: string) => void;
    onFailed: (error: unknown) => void;
};

/**
 * The rename step /sessions' ctrl+r drops into, in place of the list - same "list, then a
 * form" shape as ConnectFlow's own provider-picker → key-entry split. Exported (not just
 * used internally) for direct testing, same reasoning as ConnectForm: it takes no context
 * beyond `session`, so its submit branches are testable without mounting the picker's own
 * load/error/ready state machine around it.
 *
 * Enter submits via useKeyboard, not the `<input>`'s own onSubmit - same reason
 * OverlayList's own search box does this (see its own comment): the two prop types
 * collide, and this needs 'overlay' to own the keyboard anyway, which useKeyboard already
 * checks.
 */
export function SessionRenameForm({ session, onRenamed, onFailed }: SessionRenameFormProps) {
    const [value, setValue] = useState(session.title);
    const layers = useLayerStack();

    useKeyboard(key => {
        if (!layers.isOnTop('overlay')) return;
        if (key.name !== 'return') return;
        key.preventDefault();

        const trimmed = value.trim();
        // Blank or unchanged: nothing to actually rename, so this is a no-op cancel back
        // to the list rather than a failed API call over an empty/identical title.
        if (trimmed === '' || trimmed === session.title) {
            onRenamed(session.title);
            return;
        }

        void (async () => {
            try {
                await renameSession(session.id, trimmed);
                onRenamed(trimmed);
            } catch (error) {
                onFailed(error);
            }
        })();
    });

    return (
        <box>
            <text attributes={TextAttributes.BOLD}>Rename session</text>
            <box marginTop={1}>
                <input focused value={value} onInput={setValue} placeholder="New title" />
            </box>
        </box>
    );
}

/**
 * /sessions' overlay body. Unlike every other picker in this app (theme, model, agent,
 * effort), its items aren't already sitting in a context provider - they live on the
 * server, so this owns its own small loading/error/ready state machine instead of reading
 * one straight from a hook.
 */
export function SessionPicker() {
    const chat = useChat();
    const overlay = useOverlay();
    const toast = useToast();
    const [state, setState] = useState<LoadState>({ status: 'loading' });
    // Which row (if any) ctrl+r has dropped into the rename form for - separate from
    // `state`, since it's a UI step, not data about the sessions themselves. Escape still
    // closes the whole overlay outright from here, the same as it does from the list
    // (Overlay's own keyboard handler, not something this component overrides) - same
    // precedent as ConnectFlow's key-entry step.
    const [renaming, setRenaming] = useState<SessionSummary | null>(null);

    useEffect(() => {
        // Guards against setting state from a request that's still in flight once this
        // picker has already been dismissed (escape closes the overlay well before a slow
        // listSessions call could resolve).
        let cancelled = false;

        listSessions(process.cwd())
            .then(sessions => {
                if (!cancelled) setState({ status: 'ready', sessions });
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    if (state.status === 'loading') {
        return (
            <box paddingX={1}>
                <text attributes={TextAttributes.DIM}>Loading sessions...</text>
            </box>
        );
    }

    if (state.status === 'error') {
        return (
            <box paddingX={1}>
                <text attributes={TextAttributes.DIM}>Couldn't load sessions ({state.message})</text>
            </box>
        );
    }

    if (renaming !== null) {
        return (
            <SessionRenameForm
                session={renaming}
                onRenamed={title => {
                    setState(current =>
                        current.status === 'ready'
                            ? { status: 'ready', sessions: current.sessions.map(s => (s.id === renaming.id ? { ...s, title } : s)) }
                            : current,
                    );
                    // Keeps the Session screen's own header in sync if this is the
                    // conversation currently open - see chat.tsx's own comment on why this
                    // is a local sync, not a second API call.
                    chat.renameCurrentSession(renaming.id, title);
                    if (title !== renaming.title) toast.info(`Renamed to "${title}"`);
                    setRenaming(null);
                }}
                onFailed={error => {
                    toast.error(`Failed to rename session (${error instanceof Error ? error.message : String(error)})`);
                    setRenaming(null);
                }}
            />
        );
    }

    const handleSelect = (summary: SessionSummary) => {
        void (async () => {
            try {
                const session = await loadSession(summary.id);
                if (session === null) {
                    toast.warn('That session no longer exists.');
                    return;
                }
                chat.resumeSession(session);
                overlay.close();
            } catch (error) {
                toast.error(`Failed to open session (${error instanceof Error ? error.message : String(error)})`);
            }
        })();
    };

    // A single ctrl+d deletes outright, no separate confirm step - it's a deliberate
    // modifier chord (not a bare key a search keystroke could hit by accident), and the
    // toast below is what tells the user it actually happened.
    const handleDelete = (summary: SessionSummary) => {
        void (async () => {
            try {
                await deleteSession(summary.id);
                setState(current =>
                    current.status === 'ready'
                        ? { status: 'ready', sessions: current.sessions.filter(session => session.id !== summary.id) }
                        : current,
                );
                toast.info(`Deleted "${summary.title}"`);

                // Deleting the session currently open in chat would otherwise leave its
                // transcript sitting on screen, pointed at a session id the server no
                // longer has - the next message would 404 and surface as a confusing
                // "not saved" toast right after the user deliberately deleted it. newSession
                // clears the live conversation and detaches autosave, the same as /new, so
                // the next message starts a genuinely fresh one instead. Closing the overlay
                // too actually navigates there - left open, the reset happens behind the
                // picker and the user only sees it once they dismiss the picker themselves.
                if (summary.id === chat.sessionId) {
                    chat.newSession();
                    overlay.close();
                }
            } catch (error) {
                toast.error(`Failed to delete session (${error instanceof Error ? error.message : String(error)})`);
            }
        })();
    };

    return (
        <OverlayList
            items={state.sessions}
            getKey={session => session.id}
            filter={prefixFilter(session => session.title)}
            isActive={session => session.id === chat.sessionId}
            onSelect={handleSelect}
            onDelete={handleDelete}
            onRename={summary => setRenaming(summary)}
            renderer={(session, { isActive }) => (
                <box flexDirection="row" gap={1} justifyContent="space-between">
                    <text>
                        {isActive ? '● ' : '  '}
                        {truncate(session.title, MAX_TITLE_LENGTH)}
                    </text>
                    <text attributes={TextAttributes.DIM}>
                        {session.messageCount} msgs · {formatRelativeTime(session.updatedAt)}
                    </text>
                </box>
            )}
            emptyMessage="No sessions yet"
        />
    );
}
