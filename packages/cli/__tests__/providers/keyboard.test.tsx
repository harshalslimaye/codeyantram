import { describe, test, expect } from 'bun:test';
import { useEffect, useState } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import { useCurrentLayer, useLayerStack } from '../../src/providers/keyboard';
import { ROOT_LAYER, type Layer } from '../../src/keyboard';
import { renderWithKeyboard, tick } from '../support/mount';

function ShowLayer() {
    const layer = useCurrentLayer();
    return <text>layer:{layer}</text>;
}

// Claims `layer` until "x" is pressed, mirroring how autocomplete.tsx claims
// 'autocomplete' while open and hands it back when it closes.
function Claim({ layer = 'autocomplete' }: { layer?: Layer }) {
    const [active, setActive] = useState(true);
    const layers = useLayerStack();

    useEffect(() => {
        if (!active) return;
        return layers.push(layer);
    }, [layers, layer, active]);

    useKeyboard(key => {
        if (key.name === 'x') setActive(false);
    });
    return <text>claiming</text>;
}

describe('useCurrentLayer', () => {
    test('throws when used outside a KeyboardProvider', async () => {
        // @opentui/react wraps the tree in an ErrorBoundary, so the thrown
        // error surfaces as rendered text rather than an uncaught exception.
        // Rendered wide enough that the message does not wrap mid-sentence.
        const rendered = await testRender(<ShowLayer />, { width: 100, height: 20 });
        const frame = await rendered.waitForFrame(f => f.includes('KeyboardProvider'));

        expect(frame).toContain('useLayerStack must be used within a KeyboardProvider');
        rendered.renderer.destroy();
    });

    test('reports the root layer inside a KeyboardProvider', async () => {
        const rendered = await renderWithKeyboard(<ShowLayer />);
        const frame = await rendered.waitForFrame(f => f.includes('layer:'));

        expect(frame).toContain(`layer:${ROOT_LAYER}`);
        rendered.renderer.destroy();
    });
});

describe('claiming a layer via useLayerStack', () => {
    test('claims the layer while active', async () => {
        const rendered = await renderWithKeyboard(<Claim />);
        await tick(50);

        expect(rendered.layers.getLayer()).toBe('autocomplete');
        rendered.renderer.destroy();
    });

    test('releases the layer when the claim goes inactive', async () => {
        const rendered = await renderWithKeyboard(<Claim />);
        await tick(50);

        rendered.mockInput.pressKey('x');
        await tick(50);

        expect(rendered.layers.getLayer()).toBe(ROOT_LAYER);
        rendered.renderer.destroy();
    });

    test('releases the layer when the component unmounts', async () => {
        const rendered = await renderWithKeyboard(<Claim />);
        await tick(50);
        expect(rendered.layers.getLayer()).toBe('autocomplete');

        // Destroying the renderer unmounts the React tree, so this is the
        // effect cleanup running rather than an explicit release.
        rendered.renderer.destroy();
        await tick(50);

        expect(rendered.layers.getLayer()).toBe(ROOT_LAYER);
    });

    test('gives ownership to the most recent claim', async () => {
        const rendered = await renderWithKeyboard(
            <>
                <Claim layer="autocomplete" />
                <Claim layer="overlay" />
            </>
        );
        await tick(50);

        expect(rendered.layers.getLayer()).toBe('overlay');
        rendered.renderer.destroy();
    });
});
