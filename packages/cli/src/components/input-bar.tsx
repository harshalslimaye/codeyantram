import { useRef, useState } from 'react';
import { TextAttributes } from '@opentui/core';
import type { TextareaRenderable } from '@opentui/core';
import { useKeyboard, useRenderer } from '@opentui/react';
import { contextUsage } from '@codeyantram/shared';
import { useTheme } from '../providers/theme';
import { useModel } from '../providers/model';
import { useEffort } from '../providers/effort';
import { useAgent } from '../providers/agent';
import { getNextAgent } from '../agents';
import { useChat } from '../providers/chat';
import { useLayerStack } from '../providers/keyboard';
import { useHistory } from '../providers/history';
import { useOverlay } from '../providers/overlay';
import { ROOT_LAYER } from '../keyboard';
import { CommandMenu } from './command-menu';
import { ContextOverlay } from './context-overlay';

// Below this, the reading blends into the rest of the footer's dim chrome - there is
// nothing worth flagging yet. Between the two, it's worth a glance; past the upper one,
// worth a color the user notices without reading it. Percent, not token count: the raw
// count means little without the model's own ceiling next to it, which only the overlay
// (not this one-line footer) has room to show.
const CONTEXT_WARN_PERCENT = 50;
const CONTEXT_DANGER_PERCENT = 80;

type InputBarProps = {
    placeholder?: string;
    paddingBottom?: number;
};

// Enter submits, shift+enter inserts a newline - overrides the textarea's
// default binding (plain return -> newline, meta+return -> submit) to match
// the single-line input's prior UX.
const INPUT_MAX_ROWS = 10;

const textareaKeyBindings = [
    { name: 'return', action: 'submit' as const },
    { name: 'return', shift: true, action: 'newline' as const },
    { name: 'kpenter', action: 'submit' as const },
    { name: 'kpenter', shift: true, action: 'newline' as const },
];

export function InputBar({ placeholder = "ask anything ... 'fix the socket handshake'", paddingBottom = 0 }: InputBarProps) {
    const { colors } = useTheme();
    const { model } = useModel();
    const { effort } = useEffort();
    const { agent, setAgent } = useAgent();
    const chat = useChat();
    const history = useHistory();
    const overlay = useOverlay();
    const [value, setValue] = useState('');
    const layers = useLayerStack();
    const renderer = useRenderer();
    const textareaRef = useRef<TextareaRenderable>(null);

    // Counts setText calls this component made but whose content-change event
    // hasn't arrived yet. onContentChange fires a tick after setText rather
    // than during it (and fires even when the text is unchanged), so a plain
    // boolean would be consumed by the first of two quick recalls and let the
    // second look like the user typing. Every programmatic set produces
    // exactly one event, so a count stays in step.
    const pendingProgrammaticSets = useRef(0);

    // Clearing the prompt abandons whatever was being recalled: there is
    // nothing on screen to keep browsing from any more, so the next step back
    // should start from the newest entry again.
    const clearInput = () => {
        textareaRef.current?.clear();
        setValue('');
        history.beginDraft();
    };

    const setInputValue = (next: string) => {
        pendingProgrammaticSets.current += 1;
        const textarea = textareaRef.current;
        textarea?.setText(next);
        // setText leaves the caret at the very start. Left there, a recalled
        // prompt would sit on the top row, so the next press of up would step
        // back through history again instead of moving through the text just
        // recalled - and anything typed would land in front of it.
        if (textarea) textarea.cursorOffset = next.length;
        setValue(next);
    };

    // Editing what was recalled ends browsing: the text on screen is the
    // user's own again, so the next press of up should start from the newest
    // entry. Programmatic sets (a recall, a populated command, a clear) are
    // not edits and are skipped.
    const handleContentChange = () => {
        setValue(textareaRef.current?.plainText ?? '');

        if (pendingProgrammaticSets.current > 0) {
            pendingProgrammaticSets.current -= 1;
            return;
        }
        history.beginDraft();
    };

    // Steps through history when the caret is on the edge row in the
    // direction being pressed, and otherwise leaves the key to the textarea,
    // which moves the caret with it (see textareaKeyBindings' merge over the
    // defaults). A single-line prompt is on both edges at once, so it always
    // steps.
    const navigateHistory = (direction: 'up' | 'down'): 'handled' | 'ignored' => {
        const textarea = textareaRef.current;
        if (textarea === null) return 'ignored';

        const { visualRow } = textarea.visualCursor;

        if (direction === 'up') {
            if (visualRow !== 0) return 'ignored';

            // Read from the textarea rather than `value`, which is only as
            // fresh as the last render this handler was created in.
            const recalled = history.recallPrevious(textarea.plainText);
            // Swallowed even with nothing older to show: the caret is already
            // on the top row, so there is nothing for the textarea to do with
            // it either, and stopping at the oldest entry should feel like a
            // stop rather than a jump.
            if (recalled !== null) setInputValue(recalled);
            return 'handled';
        }

        if (visualRow !== textarea.virtualLineCount - 1) return 'ignored';

        const recalled = history.recallNext();
        // Nothing newer means the user is already on their own draft - leave
        // down alone so it keeps behaving like an ordinary caret move.
        if (recalled === null) return 'ignored';

        setInputValue(recalled);
        return 'handled';
    };

    // Escape cancels an in-flight stream if there is one, otherwise clears
    // the prompt if there's anything to clear. Ctrl+c does the same as
    // escape's clear, but quits once the prompt is already empty instead of
    // doing nothing. Submit (enter) is handled by the textarea itself via
    // onSubmit below. While autocomplete (or, later, an overlay) owns the
    // keyboard, this stays silent - that layer's own handler closes it
    // first, and root only sees the key once there's nothing left on top.
    useKeyboard(key => {
        if (!layers.isOnTop(ROOT_LAYER)) return;

        if (key.name === "escape") {
            if (chat.isStreaming) {
                key.preventDefault();
                chat.cancel();
                return;
            }
            if (value !== '') {
                key.preventDefault();
                clearInput();
                return;
            }
        }

        if ((key.name === 'up' || key.name === 'down') && !key.ctrl && !key.meta && !key.shift && !key.super) {
            // Bare arrows only: shift selects, and meta/super bind to
            // word/buffer moves the textarea should keep.
            if (navigateHistory(key.name) === 'handled') key.preventDefault();
            return;
        }

        if (key.name === 'tab') {
            key.preventDefault();
            setAgent(getNextAgent(agent));
            return;
        }

        if (key.ctrl && key.name === 't') {
            key.preventDefault();
            overlay.show('Context window', <ContextOverlay />);
            return;
        }

        if (!(key.ctrl && key.name === 'c')) return;

        key.preventDefault();
        if (value !== '') {
            clearInput();
        } else {
            renderer.destroy();
        }
    });

    // Only ever reads what the provider has already reported (see contextUsage's own
    // comment on why) - null until the first turn's "done" event lands, and left showing
    // its last reading through a cancelled/errored turn rather than reverting to nothing.
    const usage = contextUsage(chat.messages, model);
    const contextColor =
        usage === null
            ? undefined
            : usage.percent >= CONTEXT_DANGER_PERCENT
                ? colors.error
                : usage.percent >= CONTEXT_WARN_PERCENT
                    ? colors.focus
                    : undefined; // under the warn threshold blends in with the rest of the footer's dim text

    const handleSubmit = () => {
        if (chat.isStreaming) return;
        const trimmed = value.trim();
        if (trimmed === '') return;

        // Recorded here rather than in ChatProvider so only prompts the user
        // actually typed are kept - a command that sends a message of its own
        // (/init) never touches the input and shouldn't turn up in history.
        //
        // Slash commands stay out of it: CommandMenu reopens on every value
        // change, so recalling one would pop the menu, hand the keyboard to
        // the 'autocomplete' layer, and take the next press of up away from
        // history - a recall that silently stops working.
        if (!trimmed.startsWith('/')) history.record(trimmed);
        chat.sendMessage(trimmed);
        clearInput();
    };

    return (
        <box border={['left']} borderColor={colors.accent} position="relative" width="100%">
            <box backgroundColor={colors.panel} paddingX={2} paddingY={1} width="100%">
                <CommandMenu value={value} onSelect={setInputValue} />
                <textarea
                    ref={textareaRef}
                    focused
                    onContentChange={handleContentChange}
                    onSubmit={handleSubmit}
                    keyBindings={textareaKeyBindings}
                    paddingY={1}
                    paddingX={2}
                    maxHeight={INPUT_MAX_ROWS}
                    placeholder={placeholder}
                />
                <box flexDirection="row" justifyContent="space-between">
                    <box flexDirection="row" gap={1}>
                        <text fg={colors.accent}>{agent.name}</text>
                        <text attributes={TextAttributes.DIM}>›</text>
                        <text>{model.id}</text>
                        {effort !== undefined && (
                            <>
                                <text attributes={TextAttributes.DIM}>·</text>
                                <text attributes={TextAttributes.DIM}>{effort}</text>
                            </>
                        )}
                    </box>
                    <box flexDirection="row" gap={1}>
                        {/* Absent until the first turn's usage lands - a percentage with
                            nothing behind it yet would just be a confusing "0%". */}
                        {usage !== null && (
                            <text fg={contextColor} attributes={contextColor === undefined ? TextAttributes.DIM : undefined}>
                                {Math.round(usage.percent)}% ·
                            </text>
                        )}
                        {/* Only once there is something to recall - on a fresh session the
                            hint would just be crowding the footer with an unusable key. */}
                        {history.entries.length > 0 && (
                            <text attributes={TextAttributes.DIM}>↑ history ·</text>
                        )}
                        <text attributes={TextAttributes.DIM}>↵ send</text>
                    </box>
                </box>
            </box>
        </box>
    );
}
