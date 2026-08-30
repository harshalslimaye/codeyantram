import type { ReactNode } from 'react';
import { ThemePicker } from './components/theme-picker';
import { ModelPicker } from './components/model-picker';
import { AgentPicker } from './components/agent-picker';
import { ConnectFlow } from './components/connect-flow';
import type { ToastContextValue } from './providers/toast';

export type ActionArgs = {
    exit: () => void;
    populate: () => void;
    overlay: (title: string, body: ReactNode) => void;
    toast: ToastContextValue;
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
        action: args => args.toast.info('New session command selected')
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
        name: 'connect',
        description: 'Connect a provider with an API key',
        action: args => args.overlay('Connect', <ConnectFlow />)
    },
    {
        name: 'sessions',
        description: 'Switch session',
        action: args => args.toast.info('Switch session command selected')
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
