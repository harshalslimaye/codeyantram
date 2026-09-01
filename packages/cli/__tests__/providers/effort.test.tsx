import { describe, test, expect } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import {
    DEFAULT_CHAT_MODEL_ID,
    findSupportedChatModel,
    SUPPORTED_CHAT_MODELS,
    type EffortLevel,
    type SupportedChatModel,
} from '@codeyantram/shared';
import { useModel, ModelProvider } from '../../src/providers/model';
import { useEffort, EffortProvider } from '../../src/providers/effort';

const DEFAULT_MODEL = findSupportedChatModel(DEFAULT_CHAT_MODEL_ID)!;
// claude-haiku-4-5 in the catalog: supportedEffortLevels is empty.
const NO_EFFORT_MODEL = SUPPORTED_CHAT_MODELS.find(m => m.supportedEffortLevels.length === 0)!;
// gpt-5.4: supports effort, and its default ("none") differs from both the
// default model's ("high") and the "low" level the tests below pick by hand.
const OTHER_EFFORT_MODEL = findSupportedChatModel('gpt-5.4')!;
const DEFAULT_EFFORT = defaultEffortOf(DEFAULT_MODEL);
const OTHER_DEFAULT_EFFORT = defaultEffortOf(OTHER_EFFORT_MODEL);

// The catalog guarantees a model with any supportedEffortLevels also has a
// defaultEffortLevel (see models.test.ts), but the union type can't express
// that from a `.find()` predicate alone.
function defaultEffortOf(model: SupportedChatModel): EffortLevel {
    if (!("defaultEffortLevel" in model)) throw new Error(`${model.id} has no defaultEffortLevel`);
    return model.defaultEffortLevel;
}

function ShowEffort() {
    const { effort } = useEffort();
    return <text>effort:{effort ?? 'undefined'}</text>;
}

describe('useEffort', () => {
    test('throws when used outside an EffortProvider', async () => {
        // @opentui/react wraps the tree in an ErrorBoundary, so the thrown
        // error surfaces as rendered text rather than an uncaught exception.
        const rendered = await testRender(
            <ModelProvider>
                <ShowEffort />
            </ModelProvider>,
            { width: 60, height: 20 }
        );
        const frame = await rendered.waitForFrame(f => f.includes('EffortProvider'));

        expect(frame).toContain('useEffort must be used within an EffortProvider');
        rendered.renderer.destroy();
    });

    test("supplies the default model's defaultEffortLevel inside an EffortProvider", async () => {
        const rendered = await testRender(
            <ModelProvider>
                <EffortProvider>
                    <ShowEffort />
                </EffortProvider>
            </ModelProvider>,
            { width: 60, height: 20 }
        );
        const frame = await rendered.waitForFrame(f => f.includes('effort:'));

        expect(frame).toContain(`effort:${DEFAULT_EFFORT}`);
        rendered.renderer.destroy();
    });
});

describe('EffortProvider', () => {
    function SetEffortHarness() {
        const { model, setModel } = useModel();
        const { effort, setEffort } = useEffort();
        useKeyboard(key => {
            if (key.name === 'l') setEffort('low');
            if (key.name === 'n') setModel(NO_EFFORT_MODEL);
            if (key.name === 'o') setModel(OTHER_EFFORT_MODEL);
        });
        return (
            <text>
                model:{model.id} effort:{effort ?? 'undefined'}
            </text>
        );
    }

    test('setEffort changes the active effort level', async () => {
        const rendered = await testRender(
            <ModelProvider>
                <EffortProvider>
                    <SetEffortHarness />
                </EffortProvider>
            </ModelProvider>,
            { width: 60, height: 20 }
        );
        await rendered.waitForFrame(f => f.includes(`effort:${DEFAULT_EFFORT}`));

        rendered.mockInput.pressKey('l');
        const frame = await rendered.waitForFrame(f => f.includes('effort:low'));

        expect(frame).toContain('effort:low');
        rendered.renderer.destroy();
    });

    test('switching to a model with no effort control resets effort to undefined', async () => {
        const rendered = await testRender(
            <ModelProvider>
                <EffortProvider>
                    <SetEffortHarness />
                </EffortProvider>
            </ModelProvider>,
            { width: 60, height: 20 }
        );
        await rendered.waitForFrame(f => f.includes(`effort:${DEFAULT_EFFORT}`));

        rendered.mockInput.pressKey('n');
        const frame = await rendered.waitForFrame(f => f.includes(`model:${NO_EFFORT_MODEL.id}`));

        expect(frame).toContain('effort:undefined');
        rendered.renderer.destroy();
    });

    test("switching to a different effort-capable model resolves to its own default, not the previous model's", async () => {
        // OTHER_DEFAULT_EFFORT ("none") is deliberately chosen to differ from
        // DEFAULT_EFFORT ("high"), so a value carried over by mistake would
        // fail this assertion rather than passing it by coincidence.
        const rendered = await testRender(
            <ModelProvider>
                <EffortProvider>
                    <SetEffortHarness />
                </EffortProvider>
            </ModelProvider>,
            { width: 60, height: 20 }
        );
        await rendered.waitForFrame(f => f.includes(`effort:${DEFAULT_EFFORT}`));

        rendered.mockInput.pressKey('o');
        const frame = await rendered.waitForFrame(f => f.includes(`model:${OTHER_EFFORT_MODEL.id}`));

        expect(frame).toContain(`effort:${OTHER_DEFAULT_EFFORT}`);
        rendered.renderer.destroy();
    });
});
