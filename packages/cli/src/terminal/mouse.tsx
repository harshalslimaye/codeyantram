import {createContext, useContext, useEffect} from 'react';
import type {MouseWheelEvent, MouseWheelSource} from './input.js';

const MouseContext = createContext<MouseWheelSource | undefined>(undefined);
export const MouseProvider = MouseContext.Provider;

export function useMouseWheel(handler: (event: MouseWheelEvent) => void) {
	const source = useContext(MouseContext);
	useEffect(() => source?.subscribe(handler), [source, handler]);
}
