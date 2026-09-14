import { useEffect, useState } from 'react';
import { TextAttributes } from '@opentui/core';
import type { SessionSummary } from '@codeyantram/shared';
import { listSessions, loadSession } from '../api/sessions';
import { useChat } from '../providers/chat';
import { useOverlay } from '../providers/overlay';
import { useToast } from '../providers/toast';
import { formatRelativeTime } from '../utils/format';
import { prefixFilter } from '../utils/filter';
import { OverlayList } from './overlay-list';

type LoadState =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; sessions: SessionSummary[] };

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

    return (
        <OverlayList
            items={state.sessions}
            getKey={session => session.id}
            filter={prefixFilter(session => session.title)}
            isActive={session => session.id === chat.sessionId}
            onSelect={handleSelect}
            renderer={(session, { isActive }) => (
                <box flexDirection="row" gap={1} justifyContent="space-between">
                    <text>
                        {isActive ? '● ' : '  '}
                        {session.title}
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
