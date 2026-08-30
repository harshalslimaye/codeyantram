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

// Commands with real behavior beyond "fill the input with my own text" —
// excluded from the blanket "populates" check below, and covered by their
// own assertions instead.
const IMPLEMENTED_COMMANDS = ['agents', 'connect', 'exit', 'themes'];

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

    test('names are listed alphabetically', () => {
        const names = SLASH_COMMANDS.map(command => command.name);
        expect(names).toEqual([...names].sort());
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

    test('every not-yet-implemented command populates instead of exiting', () => {
        for (const command of SLASH_COMMANDS.filter(c => !IMPLEMENTED_COMMANDS.includes(c.name))) {
            const args = stubArgs();
            command.action(args);
            expect(args.populate).toHaveBeenCalledTimes(1);
        }
    });

    test('agents shows an info toast instead of populating or exiting', () => {
        const agentsCommand = SLASH_COMMANDS.find(command => command.name === 'agents');
        expect(agentsCommand).toBeDefined();

        const args = stubArgs();
        agentsCommand!.action(args);

        expect(args.toast.info).toHaveBeenCalledTimes(1);
        expect(args.toast.warn).not.toHaveBeenCalled();
        expect(args.populate).not.toHaveBeenCalled();
        expect(args.exit).not.toHaveBeenCalled();
    });

    test('connect shows a warn toast instead of populating or exiting', () => {
        const connectCommand = SLASH_COMMANDS.find(command => command.name === 'connect');
        expect(connectCommand).toBeDefined();

        const args = stubArgs();
        connectCommand!.action(args);

        expect(args.toast.warn).toHaveBeenCalledTimes(1);
        expect(args.toast.info).not.toHaveBeenCalled();
        expect(args.populate).not.toHaveBeenCalled();
        expect(args.exit).not.toHaveBeenCalled();
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
});
