import {createContext, useContext, useRef, useState, type ReactNode} from 'react';

export type KeyboardOwner = 'input-bar' | 'command-palette' | 'theme-picker' | 'model-picker' | 'effort-picker' | 'provider-picker' | 'api-key-input';

const KeyboardContext = createContext<{
	owner: KeyboardOwner;
	getOwner: () => KeyboardOwner;
	isOwner: (candidate: KeyboardOwner) => boolean;
	push: (owner: Exclude<KeyboardOwner, 'input-bar'>) => void;
	pop: (expectedOwner: Exclude<KeyboardOwner, 'input-bar'>) => void;
} | undefined>(undefined);

export function KeyboardProvider({children}: {children: ReactNode}) {
	const [stack, setStack] = useState<KeyboardOwner[]>(['input-bar']);
	const currentStack = useRef(stack);

	function updateStack(next: KeyboardOwner[]): void {
		// The next event must see the new owner even before React renders.
		currentStack.current = next;
		setStack(next);
	}

	function push(owner: Exclude<KeyboardOwner, 'input-bar'>): void {
		updateStack([...currentStack.current, owner]);
	}

	function pop(expectedOwner: Exclude<KeyboardOwner, 'input-bar'>): void {
		if (currentStack.current.length > 1 && isOwner(expectedOwner)) {
			updateStack(currentStack.current.slice(0, -1));
		}
	}

	function isOwner(candidate: KeyboardOwner): boolean {
		return currentStack.current[currentStack.current.length - 1]! === candidate;
	}

	function getOwner(): KeyboardOwner {
		return currentStack.current[currentStack.current.length - 1]!;
	}

	return (
		<KeyboardContext.Provider value={{owner: stack[stack.length - 1]!, getOwner, isOwner, push, pop}}>
			{children}
		</KeyboardContext.Provider>
	);
}

export function useKeyboardOwner() {
	const keyboard = useContext(KeyboardContext);
	if (!keyboard) throw new Error('useKeyboardOwner must be used inside KeyboardProvider.');
	return keyboard;
}
