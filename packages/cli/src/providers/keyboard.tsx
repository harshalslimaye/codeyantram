import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { LayerStack } from '../keyboard';

const LayerStackContext = createContext<LayerStack | null>(null);

export function useLayerStack() {
    const context = useContext(LayerStackContext);
    if (!context) {
        throw new Error('useLayerStack must be used within a KeyboardProvider');
    }
    return context;
}

/** Re-renders whenever the owning layer changes. */
export function useCurrentLayer() {
    const layers = useLayerStack();
    return useSyncExternalStore(layers.subscribe, layers.getLayer);
}

type KeyboardProviderProps = {
    layers: LayerStack;
    children: ReactNode;
};

export function KeyboardProvider({ layers, children }: KeyboardProviderProps) {
    return (
        <LayerStackContext.Provider value={layers}>
            {children}
        </LayerStackContext.Provider>
    );
}
