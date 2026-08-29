import { describe, test, expect } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { InputBar } from '../../src/components/input-bar';
import { ThemeProvider } from '../../src/providers/theme';

// Mirrors how Home actually wraps InputBar: headroom above so the command
// menu's "position: absolute; bottom: 100%" dropup has room to render into.
// See autocomplete.test.tsx for why each test mounts fresh and performs one
// interaction arc ending in a single wait.
function mount(props?: { placeholder?: string }) {
    return testRender(
        <ThemeProvider>
            <box paddingTop={15} width={40}>
                <InputBar {...props} />
            </box>
        </ThemeProvider>,
        { width: 40, height: 30 }
    );
}

describe('rendering', () => {
    test('shows the default placeholder', async () => {
        const rendered = await mount();
        const frame = await rendered.waitForFrame(f => f.includes('ask anything'));

        expect(frame).toContain('ask anything');
        rendered.renderer.destroy();
    });

    test('shows a custom placeholder when provided', async () => {
        const rendered = await mount({ placeholder: 'type here' });
        const frame = await rendered.waitForFrame(f => f.includes('type here'));

        expect(frame).toContain('type here');
        expect(frame).not.toContain('ask anything');
        rendered.renderer.destroy();
    });

    test('renders the model and send chrome', async () => {
        const rendered = await mount();
        const frame = await rendered.waitForFrame(f => f.includes('claude-sonnet-5'));

        expect(frame).toContain('claude-sonnet-5');
        expect(frame).toContain('send');
        rendered.renderer.destroy();
    });
});

describe('typing', () => {
    // The input is `focused` unconditionally on mount, so every test here
    // typing immediately after mount and having it register is itself the
    // coverage for "the input is focused on mount" — there is no separate
    // state to assert.

    test('typing updates the displayed value', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));

        await rendered.mockInput.typeText('hello', 15);
        const frame = await rendered.waitForFrame(f => f.includes('hello'));

        expect(frame).toContain('hello');
        rendered.renderer.destroy();
    });

    test('typing a trigger opens the command menu', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));

        await rendered.mockInput.typeText('/de', 15);
        const frame = await rendered.waitForFrame(f => f.includes('debug'));

        expect(frame).toContain('debug');
        rendered.renderer.destroy();
    });
});

describe('end to end', () => {
    test('typing a command and pressing enter fills in the full command text', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('ask anything'));

        await rendered.mockInput.typeText('/de', 15);
        rendered.mockInput.pressEnter();
        const frame = await rendered.waitForFrame(f => f.includes('/debug'));

        expect(frame).toContain('/debug');
        rendered.renderer.destroy();
    });
});
