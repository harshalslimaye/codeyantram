import { Overlay } from './overlay';
import { ApprovalPrompt } from './approval-prompt';
import { useChat } from '../providers/chat';

/**
 * Mounted unconditionally near the top of the app (see Root) rather than
 * summoned via useOverlay/OverlayProvider like the slash-command overlays -
 * this one is driven entirely by chat state (a pending tool approval), not a
 * user action, so nothing needs to call `show()` for it. Reuses <Overlay>
 * directly since that component only needs ThemeProvider/KeyboardProvider,
 * not the overlay context itself.
 */
export function ApprovalOverlay() {
    const { pendingApproval, respondToApproval } = useChat();

    if (!pendingApproval) return null;

    // Escape/ctrl+c (Overlay's own close gesture) counts as a denial rather
    // than doing nothing - a tool call must not stay open forever with no
    // way to dismiss it.
    return (
        <Overlay title="Approve tool call" onClose={() => respondToApproval(false)}>
            <ApprovalPrompt toolCall={pendingApproval} onDecide={respondToApproval} />
        </Overlay>
    );
}
