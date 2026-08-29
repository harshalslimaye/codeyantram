import type { SelectOption } from '@opentui/core';

export type ActionArgs = {
    exit: () => void;
};

export type Command = {
    name: string;
    description: string;
    action: (args: ActionArgs) => void; 
};

const noop = () => {};

export const SLASH_COMMANDS: Command[] = [
    {
        name: 'agents', 
        description: 'Switch agent', 
        action: noop 
    },
    {  
        name: 'connect', 
        description: 'Connect provider', 
        action: noop 
    },
    { 
        name: 'debug', 
        description: 'View debug info', 
        action: noop 
    },
    { 
        name: 'diff', 
        description: 'Open diff viewer', 
        action: noop 
    },
    { 
        name: 'editor', 
        description: 'Open editor', 
        action: noop 
    },
    { 
        name: 'exit', 
        description: 'Exit the app', 
        action: args => args.exit() 
    },
    { 
        name: 'help', 
        description: 'Help', 
        action: noop 
    },
    { 
        name: 'init', 
        description: 'guided AGENTS.md setup', 
        action: noop 
    },
    { 
        name: 'mcps', 
        description: 'Toggle MCPs', 
        action: noop 
    },
    { 
        name: 'models', 
        description: 'Switch model', 
        action: noop 
    },
];
