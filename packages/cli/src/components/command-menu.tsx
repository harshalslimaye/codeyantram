import { useEffect, useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { useRenderer } from '@opentui/react';

import { Autocomplete } from './autocomplete';
import { SLASH_COMMANDS, type Command } from '../commands';

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
    const selectItem = (cmd: Command) => {
        if (!activeTrigger) return;

        cmd.action({
            exit: () => renderer.destroy(),
            populate: () => onSelect(`${value.slice(0, wordStart)}${activeTrigger.char}${cmd.name} `),
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
