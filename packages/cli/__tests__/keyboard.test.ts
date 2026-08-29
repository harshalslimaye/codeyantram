import { describe, test, expect, mock } from 'bun:test';
import { createLayerStack, ROOT_LAYER } from '../src/keyboard';

describe('createLayerStack', () => {
    test('resolves to the root layer while nothing is pushed', () => {
        const layers = createLayerStack();
        expect(layers.getLayer()).toBe(ROOT_LAYER);
    });

    test('isOnTop reflects the current owner', () => {
        const layers = createLayerStack();
        expect(layers.isOnTop(ROOT_LAYER)).toBe(true);
        expect(layers.isOnTop('autocomplete')).toBe(false);

        const release = layers.push('autocomplete');
        expect(layers.isOnTop('autocomplete')).toBe(true);
        expect(layers.isOnTop(ROOT_LAYER)).toBe(false);

        release();
        expect(layers.isOnTop(ROOT_LAYER)).toBe(true);
    });

    test('hands ownership to the most recent claim and back on release', () => {
        const layers = createLayerStack();

        const release = layers.push('autocomplete');
        expect(layers.getLayer()).toBe('autocomplete');

        release();
        expect(layers.getLayer()).toBe(ROOT_LAYER);
    });

    test('restores the layer underneath rather than the root layer', () => {
        const layers = createLayerStack();

        layers.push('autocomplete');
        const releaseOverlay = layers.push('overlay');
        expect(layers.getLayer()).toBe('overlay');

        releaseOverlay();
        expect(layers.getLayer()).toBe('autocomplete');
    });

    test('releases out of order without disturbing the top', () => {
        const layers = createLayerStack();

        const releaseAutocomplete = layers.push('autocomplete');
        layers.push('overlay');

        // React tears down effects child-first, so the claim underneath can be
        // released before the one on top of it.
        releaseAutocomplete();
        expect(layers.getLayer()).toBe('overlay');
    });

    test('keeps concurrent claims of the same layer independent', () => {
        const layers = createLayerStack();

        const releaseFirst = layers.push('autocomplete');
        layers.push('autocomplete');

        releaseFirst();
        expect(layers.getLayer()).toBe('autocomplete');
    });

    test('ignores a release that runs twice', () => {
        const layers = createLayerStack();

        layers.push('autocomplete');
        const releaseOverlay = layers.push('overlay');

        releaseOverlay();
        releaseOverlay();
        expect(layers.getLayer()).toBe('autocomplete');
    });

    test('notifies subscribers when the owning layer changes', () => {
        const layers = createLayerStack();
        const listener = mock(() => {});
        const unsubscribe = layers.subscribe(listener);

        const release = layers.push('autocomplete');
        expect(listener).toHaveBeenCalledTimes(1);

        release();
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
        layers.push('overlay');
        expect(listener).toHaveBeenCalledTimes(2);
    });
});
