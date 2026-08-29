import { describe, test, expect, mock } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { OverlayList, type OverlayListItemState } from '../../src/components/overlay-list';
import { ThemeProvider } from '../../src/providers/theme';
import { KeyboardProvider } from '../../src/providers/keyboard';
import { createLayerStack } from '../../src/keyboard';
import { NO_BUILTIN_CTRL_C, tick } from '../support/mount';

// See autocomplete.test.tsx for why each test mounts fresh and performs one
// interaction arc, with real yields between key presses, ending in a single
// wait — the same "reads its useKeyboard handler via a stable ref" hazard
// applies here.

const THREE_ITEMS = ['alpha', 'beta', 'gamma'];

function renderItem(item: string, { isSelected, isActive }: OverlayListItemState) {
    const marker = isActive ? '● ' : '';
    return <text>{marker}{item}{isSelected ? ' <' : ''}</text>;
}

function mountList(overrides: Partial<{
    items: string[];
    maxVisible: number;
    isActive: (item: string) => boolean;
    onTop: boolean;
}> = {}) {
    const onSelect = mock((_item: string) => {});
    const items = overrides.items ?? THREE_ITEMS;
    const layers = createLayerStack();

    // OverlayList only reacts while 'overlay' owns the keyboard — real usage
    // guarantees that by only ever mounting inside an open `Overlay`, so
    // tests establish the same precondition directly on the stack instead
    // of dragging in a real `Overlay` for tests that don't care about it.
    if (overrides.onTop ?? true) layers.push('overlay');

    const setup = testRender(
        <KeyboardProvider layers={layers}>
            <ThemeProvider>
                <OverlayList
                    items={items}
                    getKey={item => item}
                    filter={(item, query) => item.startsWith(query)}
                    onSelect={onSelect}
                    renderer={renderItem}
                    isActive={overrides.isActive}
                    maxVisible={overrides.maxVisible}
                />
            </ThemeProvider>
        </KeyboardProvider>,
        { width: 40, height: 30, ...NO_BUILTIN_CTRL_C }
    ).then(setup => ({ ...setup, layers }));

    return { setup, onSelect };
}

describe('rendering', () => {
    test('shows the search placeholder and every item before typing', async () => {
        const { setup } = mountList();
        const rendered = await setup;
        const frame = await rendered.waitForFrame(f => f.includes('alpha'));

        expect(frame).toContain('Search');
        expect(frame).toContain('alpha');
        expect(frame).toContain('beta');
        expect(frame).toContain('gamma');
        rendered.renderer.destroy();
    });
});

describe('filtering', () => {
    test('typing filters the list by the given predicate', async () => {
        const { setup } = mountList();
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        await rendered.mockInput.typeText('be', 15);
        const frame = await rendered.waitForFrame(f => f.includes('beta'));

        expect(frame).toContain('beta');
        expect(frame).not.toContain('alpha');
        expect(frame).not.toContain('gamma');
        rendered.renderer.destroy();
    });
});

describe('keyboard navigation', () => {
    test('down moves the selection, enter selects it', async () => {
        const { setup, onSelect } = mountList();
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        rendered.mockInput.pressArrow('down');
        await tick(20);
        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => onSelect.mock.calls.length > 0);

        expect(onSelect).toHaveBeenCalledWith('beta');
        rendered.renderer.destroy();
    });

    test('up from the first row wraps to the last', async () => {
        const { setup, onSelect } = mountList();
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        rendered.mockInput.pressArrow('up');
        await tick(20);
        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => onSelect.mock.calls.length > 0);

        expect(onSelect).toHaveBeenCalledWith('gamma');
        rendered.renderer.destroy();
    });

    test('enter with no matches does nothing', async () => {
        const { setup, onSelect } = mountList();
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        await rendered.mockInput.typeText('zzz', 15);
        await rendered.waitForFrame(f => !f.includes('alpha'));
        rendered.mockInput.pressEnter();
        await tick(20);

        expect(onSelect).not.toHaveBeenCalled();
        rendered.renderer.destroy();
    });
});

describe('selection reset', () => {
    test('resets the highlighted row when the filtered set changes', async () => {
        const { setup, onSelect } = mountList();
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        // Move off row 0 first, then narrow the list so the highlight would
        // otherwise be pointing at whatever ends up at the old index.
        rendered.mockInput.pressArrow('down');
        await tick(20);
        await rendered.mockInput.typeText('g', 15);
        await rendered.waitForFrame(f => f.includes('gamma') && !f.includes('alpha'));

        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => onSelect.mock.calls.length > 0);

        expect(onSelect).toHaveBeenCalledWith('gamma');
        rendered.renderer.destroy();
    });
});

describe('isSelected / isActive', () => {
    test('are independent flags', async () => {
        const { setup } = mountList({ isActive: item => item === 'beta' });
        const rendered = await setup;
        const frame = await rendered.waitForFrame(f => f.includes('alpha'));

        // Row 0 ("alpha") is selected by default but not active.
        expect(frame).toContain('alpha <');
        // "beta" is active (marked) but, before any navigation, not selected.
        expect(frame).toContain('● beta');
        expect(frame).not.toContain('● beta <');
        rendered.renderer.destroy();
    });

    test('a row can be both selected and active at once', async () => {
        const { setup } = mountList({ isActive: item => item === 'beta' });
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        rendered.mockInput.pressArrow('down');
        const frame = await rendered.waitForFrame(f => f.includes('● beta <'));

        expect(frame).toContain('● beta <');
        rendered.renderer.destroy();
    });
});

describe('layer ownership', () => {
    test('ignores keys while another layer owns the keyboard', async () => {
        const { setup, onSelect } = mountList({ onTop: false });
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        rendered.mockInput.pressArrow('down');
        await tick(20);
        rendered.mockInput.pressEnter();
        await tick(20);

        expect(onSelect).not.toHaveBeenCalled();
        rendered.renderer.destroy();
    });
});

describe('scrolling', () => {
    const SIX_ITEMS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];

    test('shows a down indicator when more items exist below the visible window', async () => {
        const { setup } = mountList({ items: SIX_ITEMS, maxVisible: 3 });
        const rendered = await setup;
        const frame = await rendered.waitForFrame(f => f.includes('alpha'));

        expect(frame).toContain('▼');
        expect(frame).not.toContain('▲');
        rendered.renderer.destroy();
    });
});
