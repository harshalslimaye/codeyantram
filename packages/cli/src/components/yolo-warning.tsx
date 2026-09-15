import { useEffect, useRef } from 'react';
import { useAgent } from '../providers/agent';
import { useToast } from '../providers/toast';

const YOLO_WARNING =
    'Yolo skips the approval gate - edit_file, write_file, bash, and web_fetch all run immediately, with no confirmation.';

/**
 * Mounted unconditionally near the top of the app (see Root), the same as
 * ApprovalOverlay - not summoned via useOverlay, since nothing here is a
 * user-opened UI. Watches the current agent rather than wrapping setAgent
 * itself, so it fires from every path that can make Yolo active - a tab
 * press, /agents, a session resume that restores a saved agent, and a
 * preference that already was Yolo on launch - without AgentProvider (which
 * sits above ToastProvider in Root) needing to reach useToast itself.
 * hasWarnedRef keeps it to once per run: a fresh process still deserves the
 * reminder, but switching back and forth shouldn't spam it.
 */
export function YoloWarning() {
    const { agent } = useAgent();
    const toast = useToast();
    const hasWarnedRef = useRef(false);

    useEffect(() => {
        if (agent.name !== 'Yolo' || hasWarnedRef.current) return;
        hasWarnedRef.current = true;
        toast.warn(YOLO_WARNING);
    }, [agent.name, toast]);

    return null;
}
