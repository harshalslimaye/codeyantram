import { describe, test, expect, mock } from 'bun:test';
import { SLASH_COMMANDS, type ActionArgs } from '../src/commands';

function stubArgs(): ActionArgs & { exit: ReturnType<typeof mock>; populate: ReturnType<typeof mock> } {
    return { exit: mock(() => {}), populate: mock(() => {}) };
}

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
        for (const command of SLASH_COMMANDS.filter(c => c.name !== 'exit')) {
            const args = stubArgs();
            command.action(args);
            expect(args.populate).toHaveBeenCalledTimes(1);
        }
    });
});
