import { describe, test, expect, mock } from 'bun:test';
import { SLASH_COMMANDS, type ActionArgs } from '../src/commands';

function stubArgs(): ActionArgs & {
    exit: ReturnType<typeof mock>;
    populate: ReturnType<typeof mock>;
    overlay: ReturnType<typeof mock>;
    toast: { info: ReturnType<typeof mock>; warn: ReturnType<typeof mock>; error: ReturnType<typeof mock>; dismiss: ReturnType<typeof mock> };
    newSession: ReturnType<typeof mock>;
    startInit: ReturnType<typeof mock>;
    toggleProjectInstructions: ReturnType<typeof mock>;
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
        newSession: mock(() => {}),
        startInit: mock(() => {}),
        toggleProjectInstructions: mock(() => {}),
    };
}

// Commands with real behavior beyond the generic "show an info toast"
// placeholder — excluded from the blanket "shows a toast" check below, and
// covered by their own assertions instead.
const IMPLEMENTED_COMMANDS = ['new', 'exit', 'themes', 'models', 'effort', 'agents', 'connect', 'init', 'instructions', 'context', 'sessions'];

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

    test('menu order matches the finalized New/Agents/Models/Effort/Connect/Init/Instructions/Sessions/Context/Themes/Upgrade/Support/Exit list', () => {
        const names = SLASH_COMMANDS.map(command => command.name);
        expect(names).toEqual([
            'new', 'agents', 'models', 'effort', 'connect', 'init', 'instructions', 'sessions', 'context', 'themes', 'upgrade', 'support', 'exit',
        ]);
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

    test('new starts a new session instead of populating, exiting, or toasting', () => {
        const newCommand = SLASH_COMMANDS.find(command => command.name === 'new');
        expect(newCommand).toBeDefined();

        const args = stubArgs();
        newCommand!.action(args);

        expect(args.newSession).toHaveBeenCalledTimes(1);
        expect(args.populate).not.toHaveBeenCalled();
        expect(args.exit).not.toHaveBeenCalled();
        expect(args.toast.info).not.toHaveBeenCalled();
    });

    test('no other command starts a new session', () => {
        for (const command of SLASH_COMMANDS.filter(c => c.name !== 'new')) {
            const args = stubArgs();
            command.action(args);
            expect(args.newSession).not.toHaveBeenCalled();
        }
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

    test('effort opens an overlay instead of populating or exiting', () => {
        const effortCommand = SLASH_COMMANDS.find(command => command.name === 'effort');
        expect(effortCommand).toBeDefined();

        const args = stubArgs();
        effortCommand!.action(args);

        expect(args.overlay).toHaveBeenCalledTimes(1);
        expect(args.overlay.mock.calls[0]?.[0]).toBe('Effort');
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

    test('context opens an overlay instead of populating or exiting', () => {
        const contextCommand = SLASH_COMMANDS.find(command => command.name === 'context');
        expect(contextCommand).toBeDefined();

        const args = stubArgs();
        contextCommand!.action(args);

        expect(args.overlay).toHaveBeenCalledTimes(1);
        expect(args.overlay.mock.calls[0]?.[0]).toBe('Context window');
        expect(args.populate).not.toHaveBeenCalled();
        expect(args.exit).not.toHaveBeenCalled();
    });

    test('sessions opens an overlay instead of populating, exiting, or toasting', () => {
        const sessionsCommand = SLASH_COMMANDS.find(command => command.name === 'sessions');
        expect(sessionsCommand).toBeDefined();

        const args = stubArgs();
        sessionsCommand!.action(args);

        expect(args.overlay).toHaveBeenCalledTimes(1);
        expect(args.overlay.mock.calls[0]?.[0]).toBe('Sessions');
        expect(args.populate).not.toHaveBeenCalled();
        expect(args.exit).not.toHaveBeenCalled();
        expect(args.toast.info).not.toHaveBeenCalled();
    });

    test('connect opens an overlay instead of populating or exiting', () => {
        const connectCommand = SLASH_COMMANDS.find(command => command.name === 'connect');
        expect(connectCommand).toBeDefined();

        const args = stubArgs();
        connectCommand!.action(args);

        expect(args.overlay).toHaveBeenCalledTimes(1);
        expect(args.overlay.mock.calls[0]?.[0]).toBe('Connect');
        expect(args.populate).not.toHaveBeenCalled();
        expect(args.exit).not.toHaveBeenCalled();
    });

    test('init starts the init flow instead of populating, exiting, or toasting', () => {
        const initCommand = SLASH_COMMANDS.find(command => command.name === 'init');
        expect(initCommand).toBeDefined();

        const args = stubArgs();
        initCommand!.action(args);

        expect(args.startInit).toHaveBeenCalledTimes(1);
        expect(args.populate).not.toHaveBeenCalled();
        expect(args.overlay).not.toHaveBeenCalled();
        expect(args.exit).not.toHaveBeenCalled();
        expect(args.toast.info).not.toHaveBeenCalled();
    });

    test('no other command starts the init flow', () => {
        for (const command of SLASH_COMMANDS.filter(c => c.name !== 'init')) {
            const args = stubArgs();
            command.action(args);
            expect(args.startInit).not.toHaveBeenCalled();
        }
    });

    test('instructions toggles project instructions instead of populating, exiting, or toasting', () => {
        const instructionsCommand = SLASH_COMMANDS.find(command => command.name === 'instructions');
        expect(instructionsCommand).toBeDefined();

        const args = stubArgs();
        instructionsCommand!.action(args);

        expect(args.toggleProjectInstructions).toHaveBeenCalledTimes(1);
        expect(args.populate).not.toHaveBeenCalled();
        expect(args.overlay).not.toHaveBeenCalled();
        expect(args.exit).not.toHaveBeenCalled();
        expect(args.toast.info).not.toHaveBeenCalled();
    });

    test('no other command toggles project instructions', () => {
        for (const command of SLASH_COMMANDS.filter(c => c.name !== 'instructions')) {
            const args = stubArgs();
            command.action(args);
            expect(args.toggleProjectInstructions).not.toHaveBeenCalled();
        }
    });
});
