import type { ReactNode } from 'react';
import { ThemePicker } from './components/theme-picker';
import { ModelPicker } from './components/model-picker';
import { EffortPicker } from './components/effort-picker';
import { AgentPicker } from './components/agent-picker';
import { ConnectFlow } from './components/connect-flow';
import { ContextOverlay } from './components/context-overlay';
import { SessionPicker } from './components/session-picker';
import type { ToastContextValue } from './providers/toast';

export type ActionArgs = {
    exit: () => void;
    populate: () => void;
    overlay: (title: string, body: ReactNode) => void;
    toast: ToastContextValue;
    newSession: () => void;
    // Switches to the Build agent (/init needs write_file) and sends the
    // INIT_PROMPT as a normal user message - the write itself still goes
    // through the ordinary approval gate.
    startInit: () => void;
    // Flips whether the project's AGENTS.md/CLAUDE.md is loaded on the next
    // turn, without the user having to rename or delete the file.
    toggleProjectInstructions: () => void;
};

export type Command = {
    name: string;
    description: string;
    action: (args: ActionArgs) => void;
};

export const SLASH_COMMANDS: Command[] = [
    {
        name: 'new',
        description: 'Start a new session',
        action: args => args.newSession()
    },
    {
        name: 'agents',
        description: 'Switch agent',
        action: args => args.overlay('Agents', <AgentPicker />)
    },
    {
        name: 'models',
        description: 'Switch model',
        action: args => args.overlay('Models', <ModelPicker />)
    },
    {
        name: 'effort',
        description: 'Switch effort level',
        action: args => args.overlay('Effort', <EffortPicker />)
    },
    {
        name: 'connect',
        description: 'Connect a provider with an API key',
        action: args => args.overlay('Connect', <ConnectFlow />)
    },
    {
        name: 'init',
        description: 'Generate or refine this project\'s AGENTS.md',
        action: args => args.startInit()
    },
    {
        name: 'instructions',
        description: 'Toggle project instructions (AGENTS.md/CLAUDE.md) on or off',
        action: args => args.toggleProjectInstructions()
    },
    {
        name: 'sessions',
        description: 'Switch session',
        action: args => args.overlay('Sessions', <SessionPicker />)
    },
    {
        // Same overlay as the ctrl+t shortcut in input-bar.tsx - this is the
        // discoverable/typed path to it, not a second implementation.
        name: 'context',
        description: 'Show context window usage',
        action: args => args.overlay('Context window', <ContextOverlay />)
    },
    {
        name: 'themes',
        description: 'Switch theme',
        action: args => args.overlay('Themes', <ThemePicker />)
    },
    {
        name: 'upgrade',
        description: 'Upgrade CodeYantram',
        action: args => args.toast.info('Run `bun add -g codeyantram@latest` to upgrade')
    },
    {
        name: 'support',
        description: 'Get support',
        action: args => args.toast.info('Support command selected')
    },
    {
        name: 'exit',
        description: 'Exit the app',
        action: args => args.exit()
    },
];
