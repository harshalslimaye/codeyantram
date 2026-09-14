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
    emptyMessage: string;
    withOnDelete: boolean;
    withOnRename: boolean;
}> = {}) {
    const onSelect = mock((_item: string) => {});
    const onDelete = mock((_item: string) => {});
    const onRename = mock((_item: string) => {});
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
                    onDelete={overrides.withOnDelete ? onDelete : undefined}
                    onRename={overrides.withOnRename ? onRename : undefined}
                    renderer={renderItem}
                    isActive={overrides.isActive}
                    maxVisible={overrides.maxVisible}
                    emptyMessage={overrides.emptyMessage}
                />
            </ThemeProvider>
        </KeyboardProvider>,
        { width: 40, height: 30, ...NO_BUILTIN_CTRL_C }
    ).then(setup => ({ ...setup, layers }));

    return { setup, onSelect, onDelete, onRename };
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

describe('no matches', () => {
    test('shows a default message instead of the list', async () => {
        const { setup } = mountList();
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        await rendered.mockInput.typeText('zzz', 15);
        const frame = await rendered.waitForFrame(f => f.includes('No results'));

        expect(frame).toContain('No results');
        expect(frame).not.toContain('alpha');
        rendered.renderer.destroy();
    });

    test('uses a caller-supplied message when given one', async () => {
        const { setup } = mountList({ emptyMessage: 'No Themes found' });
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        await rendered.mockInput.typeText('zzz', 15);
        const frame = await rendered.waitForFrame(f => f.includes('No Themes found'));

        expect(frame).toContain('No Themes found');
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

describe('onDelete', () => {
    test('does nothing on ctrl+d when no onDelete was given', async () => {
        const { setup } = mountList();
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        expect(() => rendered.mockInput.pressKey('d', { ctrl: true })).not.toThrow();
        rendered.renderer.destroy();
    });

    test('does not show the hint when no onDelete was given', async () => {
        const { setup } = mountList();
        const rendered = await setup;
        const frame = await rendered.waitForFrame(f => f.includes('alpha'));

        expect(frame).not.toContain('ctrl+d');
        rendered.renderer.destroy();
    });

    test('shows the hint when onDelete is given', async () => {
        const { setup } = mountList({ withOnDelete: true });
        const rendered = await setup;
        const frame = await rendered.waitForFrame(f => f.includes('alpha'));

        expect(frame).toContain('ctrl+d delete');
        rendered.renderer.destroy();
    });

    test('ctrl+d calls onDelete with the highlighted item', async () => {
        const { setup, onDelete } = mountList({ withOnDelete: true });
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        rendered.mockInput.pressArrow('down');
        await tick(20);
        rendered.mockInput.pressKey('d', { ctrl: true });
        await tick(20);

        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledWith('beta');
        rendered.renderer.destroy();
    });

    test('does not fire onSelect', async () => {
        const { setup, onSelect, onDelete } = mountList({ withOnDelete: true });
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        rendered.mockInput.pressKey('d', { ctrl: true });
        await tick(20);

        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
        rendered.renderer.destroy();
    });

    test('ignores ctrl+d while another layer owns the keyboard', async () => {
        const { setup, onDelete } = mountList({ withOnDelete: true, onTop: false });
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        rendered.mockInput.pressKey('d', { ctrl: true });
        await tick(20);

        expect(onDelete).not.toHaveBeenCalled();
        rendered.renderer.destroy();
    });
});

describe('onRename', () => {
    test('does nothing on ctrl+r when no onRename was given', async () => {
        const { setup } = mountList();
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        expect(() => rendered.mockInput.pressKey('r', { ctrl: true })).not.toThrow();
        rendered.renderer.destroy();
    });

    test('does not show the hint when no onRename was given', async () => {
        const { setup } = mountList();
        const rendered = await setup;
        const frame = await rendered.waitForFrame(f => f.includes('alpha'));

        expect(frame).not.toContain('ctrl+r');
        rendered.renderer.destroy();
    });

    test('shows the hint when onRename is given', async () => {
        const { setup } = mountList({ withOnRename: true });
        const rendered = await setup;
        const frame = await rendered.waitForFrame(f => f.includes('alpha'));

        expect(frame).toContain('ctrl+r rename');
        rendered.renderer.destroy();
    });

    test('ctrl+r calls onRename with the highlighted item, not onSelect', async () => {
        const { setup, onSelect, onRename } = mountList({ withOnRename: true });
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        rendered.mockInput.pressArrow('down');
        await tick(20);
        rendered.mockInput.pressKey('r', { ctrl: true });
        await tick(20);

        expect(onRename).toHaveBeenCalledTimes(1);
        expect(onRename).toHaveBeenCalledWith('beta');
        expect(onSelect).not.toHaveBeenCalled();
        rendered.renderer.destroy();
    });

    test('ignores ctrl+r while another layer owns the keyboard', async () => {
        const { setup, onRename } = mountList({ withOnRename: true, onTop: false });
        const rendered = await setup;
        await rendered.waitForFrame(f => f.includes('alpha'));

        rendered.mockInput.pressKey('r', { ctrl: true });
        await tick(20);

        expect(onRename).not.toHaveBeenCalled();
        rendered.renderer.destroy();
    });

    test('both hints show together when onDelete and onRename are both given', async () => {
        const { setup } = mountList({ withOnDelete: true, withOnRename: true });
        const rendered = await setup;
        const frame = await rendered.waitForFrame(f => f.includes('alpha'));

        expect(frame).toContain('ctrl+r rename');
        expect(frame).toContain('ctrl+d delete');
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
