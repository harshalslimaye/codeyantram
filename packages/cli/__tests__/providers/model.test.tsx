import { describe, test, expect } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import { DEFAULT_CHAT_MODEL_ID, DEFAULT_WORKER_MODEL_ID, findSupportedChatModel, SUPPORTED_CHAT_MODELS } from '@codeyantram/shared';
import { useModel, useWorkerModel, ModelProvider, getInitialModel } from '../../src/providers/model';

const DEFAULT_MODEL = findSupportedChatModel(DEFAULT_CHAT_MODEL_ID)!;
const OTHER_MODEL = SUPPORTED_CHAT_MODELS.find(m => m.id !== DEFAULT_CHAT_MODEL_ID)!;

function ShowModel() {
    const { model } = useModel();
    return <text>{model.id}:{model.provider}</text>;
}

function ShowWorkerModel() {
    const { model } = useWorkerModel();
    return <text>{model.id}</text>;
}

function ShowBothModels() {
    const { model } = useModel();
    const { model: worker } = useWorkerModel();
    return <text>orchestrator:{model.id} worker:{worker.id}</text>;
}

describe('useModel', () => {
    test('throws when used outside a ModelProvider', async () => {
        // @opentui/react wraps the tree in an ErrorBoundary, so the thrown
        // error surfaces as rendered text rather than an uncaught exception.
        const rendered = await testRender(<ShowModel />, { width: 60, height: 20 });
        const frame = await rendered.waitForFrame(f => f.includes('ModelProvider'));

        expect(frame).toContain('useModel must be used within a ModelProvider');
        rendered.renderer.destroy();
    });

    test('supplies the default model inside a ModelProvider', async () => {
        const rendered = await testRender(
            <ModelProvider>
                <ShowModel />
            </ModelProvider>,
            { width: 60, height: 20 }
        );
        const frame = await rendered.waitForFrame(f => f.includes(DEFAULT_MODEL.id));

        expect(frame).toContain(DEFAULT_MODEL.id);
        expect(frame).toContain(DEFAULT_MODEL.provider);
        rendered.renderer.destroy();
    });
});

describe('ModelProvider', () => {
    function SetModelHarness() {
        const { model, setModel } = useModel();
        useKeyboard(key => {
            if (key.name === 's') setModel(OTHER_MODEL);
        });
        return <text>{model.id}</text>;
    }

    test('setModel changes the active model', async () => {
        const rendered = await testRender(
            <ModelProvider>
                <SetModelHarness />
            </ModelProvider>,
            { width: 60, height: 20 }
        );
        await rendered.waitForFrame(f => f.includes(DEFAULT_MODEL.id));

        rendered.mockInput.pressKey('s');
        const frame = await rendered.waitForFrame(f => f.includes(OTHER_MODEL.id));

        expect(frame).toContain(OTHER_MODEL.id);
        rendered.renderer.destroy();
    });
});

describe('test-environment guard', () => {
    // getInitialModel/persistModel go through readPreferences/writePreferences,
    // which no-op under NODE_ENV=test (see utils/preferences.test.ts) —
    // without that, every test mounting ModelProvider would depend on
    // whatever model happens to be saved on the machine running them.
    test('getInitialModel returns the default rather than reading the real file', () => {
        expect(getInitialModel()).toBe(DEFAULT_MODEL);
    });
});

describe('useWorkerModel', () => {
    test('defaults to the worker model, not the orchestrator\'s', async () => {
        const rendered = await testRender(
            <ModelProvider>
                <ShowWorkerModel />
            </ModelProvider>,
            { width: 60, height: 20 },
        );
        const frame = await rendered.waitForFrame(f => f.includes(DEFAULT_WORKER_MODEL_ID));

        expect(frame).toContain(DEFAULT_WORKER_MODEL_ID);
        rendered.renderer.destroy();
    });

    // The two roles are independent choices over the same catalog - mounting one provider
    // has to supply both, and changing one must not move the other.
    test('is independent of the orchestrator model', async () => {
        const rendered = await testRender(
            <ModelProvider>
                <ShowBothModels />
            </ModelProvider>,
            { width: 80, height: 20 },
        );
        const frame = await rendered.waitForFrame(f => f.includes('orchestrator:'));

        expect(frame).toContain(`orchestrator:${DEFAULT_CHAT_MODEL_ID}`);
        expect(frame).toContain(`worker:${DEFAULT_WORKER_MODEL_ID}`);
        rendered.renderer.destroy();
    });
});
