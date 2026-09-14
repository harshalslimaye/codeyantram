import { afterEach, beforeEach, describe, test, expect } from 'bun:test';
import { useRef, useState } from 'react';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import { HistoryProvider, useHistory } from '../../src/providers/history';
import { getPromptHistory } from '../../src/utils/prompt-history-store';
import { tick } from '../support/mount';

// Drives the context from a key handler rather than an effect, because that
// is where InputBar will call it from - a handler that reads stale state
// would show up here the same way it would in the app (see the "reads the
// latest history" test below).
//
//   r - record the next "prompt N"
//   u - step back through history, showing what it handed back
//   d - step forward, showing what it handed back
//   b - abandon browsing
function Harness() {
    const { entries, isBrowsing, record, recallPrevious, recallNext, beginDraft } = useHistory();
    const [recalled, setRecalled] = useState('none');
    const countRef = useRef(0);

    useKeyboard(key => {
        switch (key.name) {
            case 'r':
                countRef.current += 1;
                record(`prompt ${countRef.current}`);
                break;
            case 'u':
                setRecalled(String(recallPrevious('half typed')));
                break;
            case 'd':
                setRecalled(String(recallNext()));
                break;
            case 'b':
                beginDraft();
                break;
            default:
                break;
        }
    });

    return (
        <box>
            <text>entries[{entries.join('|')}]</text>
            <text>recalled[{recalled}]</text>
            <text>browsing[{String(isBrowsing())}]</text>
        </box>
    );
}

type Mounted = Awaited<ReturnType<typeof mount>>;

// A key handler's state update isn't in a frame until React flushes it, and
// waitForFrame's scheduler-idle check can catch the gap between the two and
// give up early (the same race the input-bar suite documents for its own
// clear-the-input tests). Let the flush happen, then force one render pass.
async function settle(rendered: Mounted): Promise<string> {
    await tick(50);
    await rendered.renderOnce();
    return rendered.captureCharFrame();
}

function mount() {
    return testRender(
        <HistoryProvider>
            <Harness />
        </HistoryProvider>,
        { width: 60, height: 20 }
    );
}

describe('useHistory', () => {
    test('throws when used outside a HistoryProvider', async () => {
        // @opentui/react wraps the tree in an ErrorBoundary, so the thrown
        // error surfaces as rendered text rather than an uncaught exception.
        const rendered = await testRender(<Harness />, { width: 60, height: 20 });
        const frame = await rendered.waitForFrame(f => f.includes('HistoryProvider'));

        expect(frame).toContain('useHistory must be used within a HistoryProvider');
        rendered.renderer.destroy();
    });
});

describe('HistoryProvider', () => {
    test('starts empty and composing', async () => {
        const rendered = await mount();
        const frame = await rendered.waitForFrame(f => f.includes('entries[]'));

        expect(frame).toContain('entries[]');
        expect(frame).toContain('browsing[false]');
        rendered.renderer.destroy();
    });

    test('record makes the prompt visible to consumers', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('entries[]'));

        rendered.mockInput.pressKey('r');
        const frame = await settle(rendered);

        expect(frame).toContain('entries[prompt 1]');
        rendered.renderer.destroy();
    });

    test('recallPrevious hands back the newest prompt and starts browsing', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('entries[]'));

        rendered.mockInput.pressKey('r');
        rendered.mockInput.pressKey('u');
        const frame = await settle(rendered);

        expect(frame).toContain('recalled[prompt 1]');
        expect(frame).toContain('browsing[true]');
        rendered.renderer.destroy();
    });

    test('recallNext restores the draft and goes back to composing', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('entries[]'));

        rendered.mockInput.pressKey('r');
        rendered.mockInput.pressKey('u');
        expect(await settle(rendered)).toContain('browsing[true]');

        rendered.mockInput.pressKey('d');
        const frame = await settle(rendered);

        expect(frame).toContain('recalled[half typed]');
        expect(frame).toContain('browsing[false]');
        rendered.renderer.destroy();
    });

    test('hands back null when there is nothing to step to', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('entries[]'));

        // Nothing recorded, so there is nothing older; and nothing is being
        // browsed, so there is nothing newer either.
        rendered.mockInput.pressKey('u');
        expect(await settle(rendered)).toContain('recalled[null]');
        rendered.mockInput.pressKey('d');
        const frame = await settle(rendered);

        expect(frame).toContain('recalled[null]');
        expect(frame).toContain('browsing[false]');
        rendered.renderer.destroy();
    });

    test('reads the latest history from a handler, not the render it was created in', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('entries[]'));

        // Two records back to back: the second handler call must see the
        // entry the first one added, and the recall after it must see both.
        rendered.mockInput.pressKey('r');
        rendered.mockInput.pressKey('r');
        rendered.mockInput.pressKey('u');
        const frame = await settle(rendered);

        expect(frame).toContain('entries[prompt 1|prompt 2]');
        expect(frame).toContain('recalled[prompt 2]');
        rendered.renderer.destroy();
    });

    test('beginDraft abandons browsing without losing the entries', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('entries[]'));

        rendered.mockInput.pressKey('r');
        rendered.mockInput.pressKey('u');
        expect(await settle(rendered)).toContain('browsing[true]');

        rendered.mockInput.pressKey('b');
        const frame = await settle(rendered);

        expect(frame).toContain('browsing[false]');
        expect(frame).toContain('entries[prompt 1]');
        rendered.renderer.destroy();
    });
});

describe('persistence', () => {
    const ORIGINAL_CONFIG_DIR_OVERRIDE = process.env.CODEYANTRAM_CONFIG_DIR;
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'codeyantram-history-provider-test-'));
        process.env.CODEYANTRAM_CONFIG_DIR = tempDir;
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
        if (ORIGINAL_CONFIG_DIR_OVERRIDE === undefined) delete process.env.CODEYANTRAM_CONFIG_DIR;
        else process.env.CODEYANTRAM_CONFIG_DIR = ORIGINAL_CONFIG_DIR_OVERRIDE;
    });

    test('a recorded prompt survives remounting the provider (a restart, in the real app)', async () => {
        const first = await mount();
        await first.waitForFrame(f => f.includes('entries[]'));
        first.mockInput.pressKey('r');
        await settle(first);
        first.renderer.destroy();

        const second = await mount();
        const frame = await second.waitForFrame(f => f.includes('entries[prompt 1]'));

        expect(frame).toContain('entries[prompt 1]');
        second.renderer.destroy();
    });

    test('stepping through history without recording anything writes nothing to disk', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('entries[]'));

        rendered.mockInput.pressKey('u');
        rendered.mockInput.pressKey('d');
        await settle(rendered);

        expect(getPromptHistory(process.cwd())).toEqual([]);
        rendered.renderer.destroy();
    });
});
