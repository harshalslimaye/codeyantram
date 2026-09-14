import { useEffect, useRef } from 'react';
import { listSessions, loadSession } from '../api/sessions';
import { useChat } from '../providers/chat';
import { useToast } from '../providers/toast';
import type { ResumeTarget } from '../resume';

type ResumeOnLaunchProps = {
    target: ResumeTarget;
};

/**
 * Mounted unconditionally near the top of the app, like ApprovalOverlay - renders nothing,
 * exists purely to run its effect once. Split out from index.tsx (which has a top-level
 * await that starts the real renderer the moment it's imported) so this can be exercised
 * with testRender instead.
 */
export function ResumeOnLaunch({ target }: ResumeOnLaunchProps) {
    const chat = useChat();
    const toast = useToast();
    // React 18/19 runs effects with no deps exactly once per mount, but this component
    // never remounts in practice (it lives for the process' whole lifetime) - the guard is
    // just cheap insurance against StrictMode-style double-invocation firing two competing
    // resumes.
    const hasRunRef = useRef(false);

    useEffect(() => {
        if (hasRunRef.current) return;
        hasRunRef.current = true;

        void (async () => {
            try {
                if (target.mode === 'continue') {
                    const sessions = await listSessions(process.cwd());
                    const mostRecent = sessions[0];
                    if (mostRecent === undefined) {
                        toast.info('No previous session in this project - starting fresh.');
                        return;
                    }
                    const session = await loadSession(mostRecent.id);
                    // Vanishingly unlikely (deleted between the list and the load a moment
                    // later) but still a legitimate "not found", not a bug - same as
                    // --resume's own handling below.
                    if (session === null) {
                        toast.warn('That session no longer exists - starting fresh.');
                        return;
                    }
                    chat.resumeSession(session);
                    return;
                }

                const session = await loadSession(target.id);
                if (session === null) {
                    toast.warn(`No session found with id ${target.id} - starting fresh.`);
                    return;
                }
                chat.resumeSession(session);
            } catch (error) {
                toast.error(`Failed to resume: ${error instanceof Error ? error.message : String(error)}`);
            }
        })();
    }, [chat, target, toast]);

    return null;
}
