import { describe, test, expect, mock, spyOn } from 'bun:test';
import { CommandMenu } from '../../src/components/command-menu';
import { mountDropup, settleEscape } from '../support/mount';

// See autocomplete.test.tsx for why each test mounts fresh, performs one
// interaction arc with real yields between key presses, and ends in a
// single wait.
//
// These tests exercise the real SLASH_COMMANDS list (see ../../src/commands),
// so they use whichever commands currently exist there rather than
// placeholder names — 'models' stands in for "some generic command with a
// unique prefix", 'agents'/'exit' for "any two other real commands".

function mountWithValue(value: string, onSelect = mock((_v: string) => {})) {
    const setup = mountDropup(<CommandMenu value={value} onSelect={onSelect} />);
    return { setup, onSelect };
}

describe('trigger matching and filtering', () => {
    test('"/" shows every command', async () => {
        const { setup } = mountWithValue('/');
        const rendered = await setup;
        const frame = await rendered.waitForFrame(f => f.includes('agents'));

        expect(frame).toContain('agents');
        expect(frame).toContain('exit');
        rendered.renderer.destroy();
    });

    test('"" (no trigger) shows nothing', async () => {
        const { setup } = mountWithValue('');
        const rendered = await setup;
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).not.toContain('agents');
        rendered.renderer.destroy();
    });

    test('"/mo" filters to just models', async () => {
        const { setup } = mountWithValue('/mo');
        const rendered = await setup;
        const frame = await rendered.waitForFrame(f => f.includes('models'));

        expect(frame).toContain('models');
        expect(frame).not.toContain('agents');
        expect(frame).not.toContain('exit');
        rendered.renderer.destroy();
    });

    test('trigger mid-prompt is matched, not just at the start', async () => {
        const { setup } = mountWithValue('please look at /up');
        const rendered = await setup;
        const frame = await rendered.waitForFrame(f => f.includes('upgrade'));

        expect(frame).toContain('upgrade');
        rendered.renderer.destroy();
    });

    test('"/models " (trailing space) closes the menu', async () => {
        const { setup } = mountWithValue('/models ');
        const rendered = await setup;
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).not.toContain('models');
        rendered.renderer.destroy();
    });

    test('matches by prefix only, not substring anywhere in the name', async () => {
        // "exit" contains "it", but no command *starts* with "it" — this
        // must render nothing, distinguishing startsWith from includes.
        const { setup } = mountWithValue('/it');
        const rendered = await setup;
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).not.toContain('exit');
        rendered.renderer.destroy();
    });

    test('no matches renders nothing', async () => {
        const { setup } = mountWithValue('/zzz');
        const rendered = await setup;
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        for (const name of ['agents', 'models', 'exit']) {
            expect(frame).not.toContain(name);
        }
        rendered.renderer.destroy();
    });
});

describe('selecting a command', () => {
    // 'models' (like every current command besides 'exit' and 'themes')
    // shows an info toast rather than filling in the input via `populate` —
    // see commands.test.ts for the toast-is-called assertion itself.
    // `populate` is still exercised by command-menu.tsx's wiring; it just
    // has no live command using it right now, so it isn't covered via
    // SLASH_COMMANDS here.
    test('selecting a placeholder command closes the menu without populating', async () => {
        const { setup, onSelect } = mountWithValue('/mo');
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('models'));

        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => !rendered.captureCharFrame().includes('models'));

        expect(rendered.captureCharFrame()).not.toContain('models');
        expect(onSelect).not.toHaveBeenCalled();
        rendered.renderer.destroy();
    });

    test('Tab selects the same as Enter', async () => {
        const { setup, onSelect } = mountWithValue('/mo');
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('models'));

        rendered.mockInput.pressTab();
        await rendered.waitFor(() => !rendered.captureCharFrame().includes('models'));

        expect(rendered.captureCharFrame()).not.toContain('models');
        expect(onSelect).not.toHaveBeenCalled();
        rendered.renderer.destroy();
    });

    test('selecting /exit calls the renderer\'s exit path, not onSelect', async () => {
        const { setup, onSelect } = mountWithValue('/exit');
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('exit'));

        // Swallow the real destroy so the test harness itself survives —
        // we only care that it was *asked* to destroy.
        const destroySpy = spyOn(rendered.renderer, 'destroy').mockImplementation(() => {});

        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => destroySpy.mock.calls.length > 0);

        expect(destroySpy).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();

        destroySpy.mockRestore();
    });
});

describe('open/close', () => {
    test('escape closes the menu without changing the value', async () => {
        const { setup, onSelect } = mountWithValue('/mo');
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('models'));

        rendered.mockInput.pressEscape();
        await settleEscape();
        await rendered.waitFor(() => !rendered.captureCharFrame().includes('models'));

        expect(rendered.captureCharFrame()).not.toContain('models');
        expect(onSelect).not.toHaveBeenCalled();
        rendered.renderer.destroy();
    });

    // NOTE: "does editing the value after Escape reopen the menu" is not
    // covered here. It requires a second interaction after Escape's ~100ms
    // settle delay, and that combination reliably leaves the test renderer's
    // native render loop idle and unresponsive to further input (confirmed
    // stuck even with maxPasses raised to 500 — not a patience problem).
    // The mechanism itself is a one-line `useEffect(() => setOpen(true),
    // [value])` in command-menu.tsx; "escape closes the menu" above covers
    // the other half.

    test('ctrl+c closes the menu without changing the value', async () => {
        const { setup, onSelect } = mountWithValue('/mo');
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('models'));

        rendered.mockInput.pressCtrlC();
        await rendered.waitFor(() => !rendered.captureCharFrame().includes('models'));

        expect(rendered.captureCharFrame()).not.toContain('models');
        expect(onSelect).not.toHaveBeenCalled();
        rendered.renderer.destroy();
    });
});

describe('layer ownership', () => {
    test('claims the autocomplete layer while open and releases it once closed', async () => {
        const { setup } = mountWithValue('/mo');
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('models'));

        expect(rendered.layers.isOnTop('autocomplete')).toBe(true);

        rendered.mockInput.pressEscape();
        await settleEscape();
        await rendered.waitFor(() => rendered.layers.isOnTop('root'));

        expect(rendered.layers.isOnTop('root')).toBe(true);
        rendered.renderer.destroy();
    });

    // Selecting a command that opens an overlay doesn't change `value` the
    // way a populate command does, so nothing incidentally causes the menu
    // to close — unlike populate commands, where the newly-filled text no
    // longer matching anything closes it as a side effect. Without an
    // explicit close, 'autocomplete' stays claimed underneath 'overlay' the
    // whole time, and closing the overlay would hand ownership back to
    // 'autocomplete' instead of 'root'.
    test('selecting an overlay command closes the menu, not just opens the overlay on top of it', async () => {
        const { setup } = mountWithValue('/themes');
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('themes'));

        rendered.mockInput.pressEnter();
        await rendered.waitForFrame(f => f.includes('Themes'));

        // Close the overlay and check what layer is left underneath it.
        rendered.mockInput.pressEscape();
        await settleEscape();
        await rendered.waitFor(() => !rendered.captureCharFrame().includes('Themes'));

        expect(rendered.layers.isOnTop('root')).toBe(true);
        expect(rendered.layers.isOnTop('autocomplete')).toBe(false);
        rendered.renderer.destroy();
    });

    test('selecting an overlay command clears the prompt, like populate does', async () => {
        const { setup, onSelect } = mountWithValue('/themes');
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('themes'));

        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => onSelect.mock.calls.length > 0);

        expect(onSelect).toHaveBeenCalledWith('');
        rendered.renderer.destroy();
    });
});
