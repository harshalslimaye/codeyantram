import type { SelectOption } from '@opentui/core';

export type ActionArgs = {
    exit: () => void;
    populate: () => void;
};

export type Command = {
    name: string;
    description: string;
    action: (args: ActionArgs) => void;
};

// Default for commands with no real implementation yet: just fill the
// command text into the input, same as picking any other autocomplete item.
const populate: Command['action'] = args => args.populate();

export const SLASH_COMMANDS: Command[] = [
    {
        name: 'agents',
        description: 'Switch agent',
        action: populate
    },
    {
        name: 'connect',
        description: 'Connect provider',
        action: populate
    },
    {
        name: 'debug',
        description: 'View debug info',
        action: populate
    },
    {
        name: 'diff',
        description: 'Open diff viewer',
        action: populate
    },
    {
        name: 'editor',
        description: 'Open editor',
        action: populate
    },
    {
        name: 'exit',
        description: 'Exit the app',
        action: args => args.exit()
    },
    {
        name: 'help',
        description: 'Help',
        action: populate
    },
    {
        name: 'init',
        description: 'guided AGENTS.md setup',
        action: populate
    },
    {
        name: 'mcps',
        description: 'Toggle MCPs',
        action: populate
    },
    {
        name: 'models',
        description: 'Switch model',
        action: populate
    },
];
