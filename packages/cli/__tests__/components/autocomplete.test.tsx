import { describe, test, expect, mock } from 'bun:test';
import { useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { Autocomplete } from '../../src/components/autocomplete';
import type { Command } from '../../src/commands';
import { mountDropup, tick, settleEscape } from '../support/mount';

// `Autocomplete` reads its `useKeyboard` handler via a stable ref (React's
// "effect event" pattern), which is only up to date once React has actually
// committed the render that followed the previous key press. Firing key
// presses back-to-back with no yield in between means a later press's
// handler still closes over the *previous* render's state (e.g. Enter would
// read a stale `selectedIndex`). A real `tick()` between presses gives React
// a chance to commit first. Because of this, and because a resolved
// `waitFor` appears to leave the renderer idle for anything further, each
// test below mounts fresh and performs exactly one interaction arc ending in
// a single wait — chaining multiple waited interactions in one test was
// unreliable during development.

const noop = () => {};
function makeItems(names: string[]): Command[] {
    return names.map(name => ({ name, description: `${name} description`, action: noop }));
}

const THREE_ITEMS = makeItems(['alpha', 'beta', 'gamma']);

function mountMenu(overrides: Partial<{
    items: Command[];
    open: boolean;
    maxVisible: number;
}> = {}) {
    const onEnter = mock((_item: Command) => {});
    const onTab = mock((_item: Command) => {});
    const onClose = mock(() => {});
    const items = overrides.items ?? THREE_ITEMS;
    const open = overrides.open ?? true;

    const setup = mountDropup(
        <Autocomplete
            items={items}
            open={open}
            maxVisible={overrides.maxVisible}
            onEnter={onEnter}
            onTab={onTab}
            onClose={onClose}
            renderer={item => <text>{item.name}</text>}
        />
    );

    return { setup, onEnter, onTab, onClose };
}

describe('visibility', () => {
    test('open=false renders nothing', async () => {
        const { setup } = mountMenu({ open: false });
        const rendered = await setup;
        await rendered.renderOnce();
        expect(rendered.captureCharFrame()).not.toContain('alpha');
        rendered.renderer.destroy();
    });

    test('items=[] renders nothing even when open', async () => {
        const { setup } = mountMenu({ items: [] });
        const rendered = await setup;
        await rendered.renderOnce();
        const frame = rendered.captureCharFrame();
        expect(frame).not.toContain('alpha');
        expect(frame).not.toContain('▲');
        expect(frame).not.toContain('▼');
        rendered.renderer.destroy();
    });

    test('open=true with items renders all of them', async () => {
        const { setup } = mountMenu();
        const rendered = await setup;
        const frame = await rendered.waitForFrame(f => f.includes('alpha') && f.includes('gamma'));
        expect(frame).toContain('alpha');
        expect(frame).toContain('beta');
        expect(frame).toContain('gamma');
        rendered.renderer.destroy();
    });
});

describe('keyboard navigation', () => {
    test('down moves the highlighted item forward', async () => {
        const { setup, onEnter } = mountMenu();
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        rendered.mockInput.pressArrow('down');
        await tick();
        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => onEnter.mock.calls.length > 0);

        expect(onEnter.mock.calls[0]?.[0]?.name).toBe('beta');
        rendered.renderer.destroy();
    });

    test('up from the first item wraps to the last', async () => {
        const { setup, onEnter } = mountMenu();
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        rendered.mockInput.pressArrow('up');
        await tick();
        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => onEnter.mock.calls.length > 0);

        expect(onEnter.mock.calls[0]?.[0]?.name).toBe('gamma');
        rendered.renderer.destroy();
    });

    test('down from the last item wraps to the first', async () => {
        const { setup, onEnter } = mountMenu();
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        rendered.mockInput.pressArrow('down');
        await tick();
        rendered.mockInput.pressArrow('down');
        await tick();
        rendered.mockInput.pressArrow('down'); // alpha -> beta -> gamma -> wraps to alpha
        await tick();
        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => onEnter.mock.calls.length > 0);

        expect(onEnter.mock.calls[0]?.[0]?.name).toBe('alpha');
        rendered.renderer.destroy();
    });

    test('keys are ignored while closed', async () => {
        const { setup, onEnter } = mountMenu({ open: false, items: THREE_ITEMS });
        // items alone won't render since open=false, but the keyboard
        // handler itself should also no-op rather than throwing/selecting.
        const rendered = await setup;
        await rendered.renderOnce();

        rendered.mockInput.pressArrow('down');
        await tick();
        rendered.mockInput.pressEnter();
        await tick(50);

        expect(onEnter).not.toHaveBeenCalled();
        rendered.renderer.destroy();
    });
});

describe('enter vs tab', () => {
    test('return calls onEnter, not onTab', async () => {
        const { setup, onEnter, onTab } = mountMenu();
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => onEnter.mock.calls.length > 0);

        expect(onEnter).toHaveBeenCalledTimes(1);
        expect(onTab).not.toHaveBeenCalled();
        expect(onEnter.mock.calls[0]?.[0]?.name).toBe('alpha');
        rendered.renderer.destroy();
    });

    test('tab calls onTab, not onEnter', async () => {
        const { setup, onEnter, onTab } = mountMenu();
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        rendered.mockInput.pressTab();
        await rendered.waitFor(() => onTab.mock.calls.length > 0);

        expect(onTab).toHaveBeenCalledTimes(1);
        expect(onEnter).not.toHaveBeenCalled();
        expect(onTab.mock.calls[0]?.[0]?.name).toBe('alpha');
        rendered.renderer.destroy();
    });
});

describe('escape', () => {
    test('escape calls onClose', async () => {
        const { setup, onClose } = mountMenu();
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        rendered.mockInput.pressEscape();
        await settleEscape();
        await rendered.waitFor(() => onClose.mock.calls.length > 0);

        expect(onClose).toHaveBeenCalledTimes(1);
        rendered.renderer.destroy();
    });
});

describe('scrolling', () => {
    const TEN_ITEMS = makeItems([
        'agents', 'connect', 'debug', 'diff', 'editor',
        'exit', 'help', 'init', 'mcps', 'models',
    ]);

    test('items.length <= maxVisible renders everything with no indicators', async () => {
        const { setup } = mountMenu({ items: THREE_ITEMS, maxVisible: 8 });
        const rendered = await setup;
        const frame = await rendered.waitForFrame(f => f.includes('alpha'));

        expect(frame).not.toContain('▲');
        expect(frame).not.toContain('▼');
        rendered.renderer.destroy();
    });

    test('more items than maxVisible shows only the window, with ▼ but no ▲ at the top', async () => {
        const { setup } = mountMenu({ items: TEN_ITEMS, maxVisible: 8 });
        const rendered = await setup;
        const frame = await rendered.waitForFrame(f => f.includes('agents'));

        expect(frame).toContain('agents');
        expect(frame).toContain('init'); // 8th item, last one in the window
        expect(frame).not.toContain('mcps'); // 9th item, scrolled out
        expect(frame).not.toContain('▲');
        expect(frame).toContain('▼');
        rendered.renderer.destroy();
    });

    test('scrolling to the last item shows ▲ but no ▼', async () => {
        const { setup, onEnter } = mountMenu({ items: TEN_ITEMS, maxVisible: 8 });
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('agents'));

        for (let i = 0; i < 9; i++) {
            rendered.mockInput.pressArrow('down');
            await tick();
        }
        const frame = await rendered.waitForFrame(f => f.includes('models'));

        expect(frame).toContain('▲');
        expect(frame).not.toContain('▼');
        expect(frame).not.toContain('agents'); // scrolled out at the top

        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => onEnter.mock.calls.length > 0);
        expect(onEnter.mock.calls[0]?.[0]?.name).toBe('models');

        rendered.renderer.destroy();
    });
});

describe('selection reset', () => {
    // A small stateful wrapper standing in for what CommandMenu does in
    // practice: it re-renders Autocomplete with a *different* `items` array
    // once the filter query changes. The swap is triggered by pressing "s"
    // (routed through the harness's own useKeyboard) rather than an
    // independent timer, so it's part of the same single interaction arc as
    // the rest of the test instead of racing the test renderer's idle
    // detection for a second, unrelated render pass.
    const OTHER_ITEMS = makeItems(['delta', 'echo']);

    function ItemsSwapHarness({ onEnter }: { onEnter: (item: Command) => void }) {
        const [items, setItems] = useState(THREE_ITEMS);
        useKeyboard(key => {
            if (key.name === 's') setItems(OTHER_ITEMS);
        });

        return (
            <Autocomplete
                items={items}
                open={true}
                onEnter={onEnter}
                onTab={mock(() => {})}
                onClose={mock(() => {})}
                renderer={item => <text>{item.name}</text>}
            />
        );
    }

    test('replacing the item list resets the highlighted row to its first item', async () => {
        const onEnter = mock((_item: Command) => {});
        const rendered = await mountDropup(<ItemsSwapHarness onEnter={onEnter} />);
        await rendered.waitForFrame(f => f.includes('alpha'));

        // Move off the first item of the original list, then swap to a
        // different item list entirely (standing in for a changed filter).
        rendered.mockInput.pressArrow('down');
        await tick();
        rendered.mockInput.pressKey('s');
        await tick();

        // If selectedIndex had carried over (still 1), Enter would hit
        // "echo" (index 1 of the new list) instead of "delta" (index 0).
        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => onEnter.mock.calls.length > 0);
        expect(onEnter.mock.calls[0]?.[0]?.name).toBe('delta');

        rendered.renderer.destroy();
    });
});
