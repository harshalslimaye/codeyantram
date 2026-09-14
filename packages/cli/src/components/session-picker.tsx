import { useEffect, useState } from 'react';
import { TextAttributes } from '@opentui/core';
import type { SessionSummary } from '@codeyantram/shared';
import { deleteSession, listSessions, loadSession } from '../api/sessions';
import { useChat } from '../providers/chat';
import { useOverlay } from '../providers/overlay';
import { useToast } from '../providers/toast';
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
                // clears the live conversation and detaches autosave, the same as /new,
                // so the next message starts a genuinely fresh one instead.
                if (summary.id === chat.sessionId) chat.newSession();
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
