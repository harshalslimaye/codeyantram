// Every layer that can claim the keyboard. A closed union rather than a bare
// `string` so a typo (`'autocomplet'`) fails at compile time instead of
// silently creating a layer nothing ever checks for.
export type Layer = 'root' | 'autocomplete' | 'overlay';

// The layer that owns the keyboard when nothing else has claimed it. Never
// pushed and never popped — it is what an empty stack resolves to.
export const ROOT_LAYER: Layer = 'root';

export type LayerStack = {
    /** The layer that currently owns the keyboard. */
    getLayer(): Layer;
    /** Whether `layer` is the one that currently owns the keyboard. */
    isOnTop(layer: Layer): boolean;
    /** Notifies `listener` whenever the owning layer changes; returns an unsubscribe function. */
    subscribe(listener: () => void): () => void;
    /** Claims ownership until the returned disposer runs. */
    push(layer: Layer): () => void;
};

export function createLayerStack(): LayerStack {
    // Entries are identified by a symbol rather than by their layer name or
    // their position: two components may claim the same layer at once, and
    // React tears down effects child-first, so pops arrive out of order.
    // Removing by identity makes both cases fall out for free, and makes a
    // disposer that runs twice a no-op the second time.
    const entries: { id: symbol; layer: Layer }[] = [];
    const listeners = new Set<() => void>();

    const getLayer = () => entries.at(-1)?.layer ?? ROOT_LAYER;

    return {
        getLayer,
        isOnTop: layer => getLayer() === layer,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        push(layer) {
            const id = Symbol(layer);
            entries.push({ id, layer });
            listeners.forEach(listener => listener());

            return () => {
                const index = entries.findIndex(entry => entry.id === id);
                if (index === -1) return;
                entries.splice(index, 1);
                listeners.forEach(listener => listener());
            };
        },
    };
}
