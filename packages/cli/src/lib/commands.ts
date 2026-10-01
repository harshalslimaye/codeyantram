export const COMMANDS = [
    { command: '/help', description: 'Show available commands' },
    { command: '/model', description: 'Change the active model' },
    { command: '/theme', description: 'Choose a terminal theme' },
    { command: '/clear', description: 'Clear the conversation' },
    { command: '/exit', description: 'Exit Codeyantram' },
];

export function getCommandOptions(query: string = '') {
    return query.trim() === '' ? COMMANDS.map(item => ({
        value: item.command,
        label: `${item.command.padEnd(8)}${item.description}`,
    })) : COMMANDS.filter(item => item.command.slice(1).startsWith(query)).map(item => ({
        value: item.command,
        label: `${item.command.padEnd(8)}${item.description}`,
    }));
}