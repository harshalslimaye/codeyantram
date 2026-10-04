interface Command {
    command: string;
    description: string;
}

export const COMMANDS: Command[] = [
    { command: '/help', description: 'Show available commands' },
    { command: '/status', description: 'Show model and estimated context usage' },
    { command: '/model', description: 'Change the active model' },
    { command: '/connect', description: 'Configure a provider API key' },
    { command: '/theme', description: 'Choose a terminal theme' },
    { command: '/compact', description: 'Summarize older conversation context' },
    { command: '/clear', description: 'Clear the conversation' },
    { command: '/exit', description: 'Exit Codeyantram' },
];

export function getCommandOptions(query: string = '') {
    const keyword = query.toLowerCase().trim();
    return keyword === ''
        ? COMMANDS.map(getCommand)
        : COMMANDS.filter(item => item.command.slice(1).toLowerCase().startsWith(keyword)).map(getCommand);
}

function getCommand(item: Command): { value: string, label: string } {
    return {
        value: item.command,
        label: `${item.command.padEnd(12)}${item.description}`,
    }
}
