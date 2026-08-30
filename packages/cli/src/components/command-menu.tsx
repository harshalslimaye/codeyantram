import { useEffect, useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { useRenderer } from '@opentui/react';

import { Autocomplete } from './autocomplete';
import { SLASH_COMMANDS, type Command } from '../commands';
import { useOverlay } from '../providers/overlay';
import { useToast } from '../providers/toast';
import { useChat } from '../providers/chat';

type Trigger = {
    char: string;
    items: Command[];
};

const TRIGGERS: Trigger[] = [{ char: '/', items: SLASH_COMMANDS }];

// The word currently being typed is everything after the last space, so a
// trigger (e.g. "/" or a future "@") can be matched anywhere in the value,
// not just at the very start of it.
function getCurrentWordStart(value: string) {
    return value.lastIndexOf(' ') + 1;
}

type CommandMenuProps = {
    value: string;
    onSelect: (nextValue: string) => void;
};

export function CommandMenu({ value, onSelect }: CommandMenuProps) {
    const [open, setOpen] = useState(true);
    const renderer = useRenderer();
    const { show } = useOverlay();
    const toast = useToast();
    const { newSession } = useChat();

    useEffect(() => {
        setOpen(true);
    }, [value]);

    const wordStart = getCurrentWordStart(value);
    const word = value.slice(wordStart);
    const activeTrigger = TRIGGERS.find(trigger => word.startsWith(trigger.char));
    const query = activeTrigger ? word.slice(activeTrigger.char.length) : '';
    const matches = activeTrigger
        ? activeTrigger.items.filter(item => item.name.startsWith(query))
        : [];

    // For commands, Enter and Tab both just select the highlighted command.
    // Each command's action decides what "selecting" it actually does —
    // populate fills the input with this command's full text (the default,
    // for commands with no real implementation yet), exit quits the app.
    //
    // Closing the menu here, before running the action, matters for more
    // than populate commands: a populate command's own filled-in text no
    // longer matching anything closes it as an incidental side effect, but
    // a command that opens an overlay never touches `value` at all, so
    // nothing else would close it. Left open, 'autocomplete' would stay
    // claimed underneath 'overlay' the whole time it's shown, and closing
    // the overlay would hand ownership back to 'autocomplete' instead of
    // 'root'.
    const selectItem = (cmd: Command) => {
        if (!activeTrigger) return;

        setOpen(false);
        cmd.action({
            exit: () => renderer.destroy(),
            populate: () => onSelect(`${value.slice(0, wordStart)}${activeTrigger.char}${cmd.name} `),
            // Clears the prompt the same way populate replaces it — an
            // overlay command is done with the input once it's opened one,
            // the same way a populate command is done once it's filled in
            // its text. An empty value also has no active trigger, so this
            // does not race the layer release above by reopening the menu.
            overlay: (title, body) => {
                onSelect('');
                show(title, body);
            },
            toast,
            newSession,
        });
    };

    return (
        <Autocomplete
            items={matches}
            open={open}
            onClose={() => setOpen(false)}
            onEnter={selectItem}
            onTab={selectItem}
            renderer={item => (
                <box flexDirection="row">
                    <text width={12}>{item.name}</text>
                    <text attributes={TextAttributes.DIM}>{item.description}</text>
                </box>
            )}
        />
    );
}
