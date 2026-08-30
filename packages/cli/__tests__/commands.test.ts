import { describe, test, expect, mock } from 'bun:test';
import { SLASH_COMMANDS, type ActionArgs } from '../src/commands';

function stubArgs(): ActionArgs & {
    exit: ReturnType<typeof mock>;
    populate: ReturnType<typeof mock>;
    overlay: ReturnType<typeof mock>;
    toast: { info: ReturnType<typeof mock>; warn: ReturnType<typeof mock>; error: ReturnType<typeof mock>; dismiss: ReturnType<typeof mock> };
} {
    return {
        exit: mock(() => {}),
        populate: mock(() => {}),
        overlay: mock(() => {}),
        toast: {
            info: mock(() => 'id'),
            warn: mock(() => 'id'),
            error: mock(() => 'id'),
            dismiss: mock(() => {}),
        },
    };
}

// Commands with real behavior beyond the generic "show an info toast"
// placeholder — excluded from the blanket "shows a toast" check below, and
// covered by their own assertions instead.
const IMPLEMENTED_COMMANDS = ['exit', 'themes', 'models', 'agents'];

describe('SLASH_COMMANDS', () => {
    test('every command has a name and description', () => {
        for (const command of SLASH_COMMANDS) {
            expect(command.name).toBeTruthy();
            expect(command.description).toBeTruthy();
        }
    });

    test('names are unique', () => {
        const names = SLASH_COMMANDS.map(command => command.name);
        expect(new Set(names).size).toBe(names.length);
    });

    test('names contain no spaces', () => {
        // The menu matches on the word after the trigger char, so a name
        // with a space in it could never be matched or selected.
        for (const command of SLASH_COMMANDS) {
            expect(command.name).not.toContain(' ');
        }
    });

    test('menu order matches the finalized New/Agents/Models/Sessions/Themes/Upgrade/Support/Exit list', () => {
        const names = SLASH_COMMANDS.map(command => command.name);
        expect(names).toEqual(['new', 'agents', 'models', 'sessions', 'themes', 'upgrade', 'support', 'exit']);
    });
});

describe('command actions', () => {
    test('exit calls the exit capability', () => {
        const exitCommand = SLASH_COMMANDS.find(command => command.name === 'exit');
        expect(exitCommand).toBeDefined();

        const args = stubArgs();
        exitCommand!.action(args);

        expect(args.exit).toHaveBeenCalledTimes(1);
    });

    test('no other command exits the app', () => {
        for (const command of SLASH_COMMANDS.filter(c => c.name !== 'exit')) {
            const args = stubArgs();
            command.action(args);
            expect(args.exit).not.toHaveBeenCalled();
        }
    });

    test('exit does not populate the input', () => {
        const exitCommand = SLASH_COMMANDS.find(command => command.name === 'exit');
        const args = stubArgs();
        exitCommand!.action(args);

        expect(args.populate).not.toHaveBeenCalled();
    });

    test('every generic placeholder command shows an info toast instead of populating or exiting', () => {
        for (const command of SLASH_COMMANDS.filter(c => !IMPLEMENTED_COMMANDS.includes(c.name))) {
            const args = stubArgs();
            command.action(args);

            expect(args.toast.info).toHaveBeenCalledTimes(1);
            expect(args.populate).not.toHaveBeenCalled();
            expect(args.exit).not.toHaveBeenCalled();
        }
    });

    test('themes opens an overlay instead of populating or exiting', () => {
        const themesCommand = SLASH_COMMANDS.find(command => command.name === 'themes');
        expect(themesCommand).toBeDefined();

        const args = stubArgs();
        themesCommand!.action(args);

        expect(args.overlay).toHaveBeenCalledTimes(1);
        expect(args.overlay.mock.calls[0]?.[0]).toBe('Themes');
        expect(args.populate).not.toHaveBeenCalled();
        expect(args.exit).not.toHaveBeenCalled();
    });

    test('models opens an overlay instead of populating or exiting', () => {
        const modelsCommand = SLASH_COMMANDS.find(command => command.name === 'models');
        expect(modelsCommand).toBeDefined();

        const args = stubArgs();
        modelsCommand!.action(args);

        expect(args.overlay).toHaveBeenCalledTimes(1);
        expect(args.overlay.mock.calls[0]?.[0]).toBe('Models');
        expect(args.populate).not.toHaveBeenCalled();
        expect(args.exit).not.toHaveBeenCalled();
    });

    test('agents opens an overlay instead of populating or exiting', () => {
        const agentsCommand = SLASH_COMMANDS.find(command => command.name === 'agents');
        expect(agentsCommand).toBeDefined();

        const args = stubArgs();
        agentsCommand!.action(args);

        expect(args.overlay).toHaveBeenCalledTimes(1);
        expect(args.overlay.mock.calls[0]?.[0]).toBe('Agents');
        expect(args.populate).not.toHaveBeenCalled();
        expect(args.exit).not.toHaveBeenCalled();
    });
});
