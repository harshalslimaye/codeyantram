import { describe, test, expect, mock, spyOn } from 'bun:test';
import { CommandMenu } from '../../src/components/command-menu';
import { mountDropup, settleEscape } from '../support/mount';

// See autocomplete.test.tsx for why each test mounts fresh, performs one
// interaction arc with real yields between key presses, and ends in a
// single wait.

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
        expect(frame).toContain('connect');
        rendered.renderer.destroy();
    });

    test('"" (no trigger) shows nothing', async () => {
        const { setup } = mountWithValue('');
        const rendered = await setup;
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).not.toContain('agents');
        rendered.renderer.destroy();
    });

    test('"/de" filters to just debug', async () => {
        const { setup } = mountWithValue('/de');
        const rendered = await setup;
        const frame = await rendered.waitForFrame(f => f.includes('debug'));

        expect(frame).toContain('debug');
        expect(frame).not.toContain('agents');
        expect(frame).not.toContain('exit');
        rendered.renderer.destroy();
    });

    test('trigger mid-prompt is matched, not just at the start', async () => {
        const { setup } = mountWithValue('please look at /he');
        const rendered = await setup;
        const frame = await rendered.waitForFrame(f => f.includes('help'));

        expect(frame).toContain('help');
        rendered.renderer.destroy();
    });

    test('"/debug " (trailing space) closes the menu', async () => {
        const { setup } = mountWithValue('/debug ');
        const rendered = await setup;
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).not.toContain('debug');
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
        for (const name of ['agents', 'connect', 'debug']) {
            expect(frame).not.toContain(name);
        }
        rendered.renderer.destroy();
    });
});

describe('selecting a command', () => {
    test('selecting a populate-based command fills in the full command text', async () => {
        const { setup, onSelect } = mountWithValue('/de');
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('debug'));

        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => onSelect.mock.calls.length > 0);

        expect(onSelect).toHaveBeenCalledWith('/debug ');
        rendered.renderer.destroy();
    });

    test('selecting preserves text before the trigger word', async () => {
        const { setup, onSelect } = mountWithValue('please look at /de');
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('debug'));

        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => onSelect.mock.calls.length > 0);

        expect(onSelect).toHaveBeenCalledWith('please look at /debug ');
        rendered.renderer.destroy();
    });

    test('Tab selects the same as Enter', async () => {
        const { setup, onSelect } = mountWithValue('/de');
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('debug'));

        rendered.mockInput.pressTab();
        await rendered.waitFor(() => onSelect.mock.calls.length > 0);

        expect(onSelect).toHaveBeenCalledWith('/debug ');
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
        const { setup, onSelect } = mountWithValue('/de');
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('debug'));

        rendered.mockInput.pressEscape();
        await settleEscape();
        await rendered.waitFor(() => !rendered.captureCharFrame().includes('debug'));

        expect(rendered.captureCharFrame()).not.toContain('debug');
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
        const { setup, onSelect } = mountWithValue('/de');
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('debug'));

        rendered.mockInput.pressCtrlC();
        await rendered.waitFor(() => !rendered.captureCharFrame().includes('debug'));

        expect(rendered.captureCharFrame()).not.toContain('debug');
        expect(onSelect).not.toHaveBeenCalled();
        rendered.renderer.destroy();
    });
});

describe('layer ownership', () => {
    test('claims the autocomplete layer while open and releases it once closed', async () => {
        const { setup } = mountWithValue('/de');
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('debug'));

        expect(rendered.layers.isOnTop('autocomplete')).toBe(true);

        rendered.mockInput.pressEscape();
        await settleEscape();
        await rendered.waitFor(() => rendered.layers.isOnTop('root'));

        expect(rendered.layers.isOnTop('root')).toBe(true);
        rendered.renderer.destroy();
    });
});
