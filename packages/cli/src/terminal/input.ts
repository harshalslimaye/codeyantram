import {PassThrough} from 'node:stream';
import {StringDecoder} from 'node:string_decoder';

const MOUSE_WHEEL_FLAG = 64;
const MOUSE_BUTTON_MASK = 3;
const ESCAPE_FLUSH_DELAY_MS = 30;

export interface MouseWheelEvent {
	direction: 'up' | 'down';
	x: number;
	y: number;
}

export interface MouseWheelSource {
	subscribe: (listener: (event: MouseWheelEvent) => void) => () => void;
}

const enableMouse = '\x1b[?1000h\x1b[?1006h';
const disableMouse = '\x1b[?1006l\x1b[?1000l';

/** Separate terminal mouse reports from keyboard input before Ink parses it. */
export function createTerminalInput(source: NodeJS.ReadStream, stdout: NodeJS.WriteStream) {
	const stream = new PassThrough();
	const listeners = new Set<(event: MouseWheelEvent) => void>();
	const decoder = new StringDecoder('utf8');
	let pending = '';
	let pasted = false;
	let active = false;
	let mouseEnabled = false;
	let flushTimer: ReturnType<typeof setTimeout> | undefined;

	function clearTimer() {
		if (flushTimer) clearTimeout(flushTimer);
		flushTimer = undefined;
	}

	function receive(chunk: Buffer | string) {
		clearTimer();
		pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
		let keyboard = '';
		while (pending) {
			const escape = pending.indexOf('\x1b');
			if (escape === -1) {
				keyboard += pending;
				pending = '';
				break;
			}
			keyboard += pending.slice(0, escape);
			pending = pending.slice(escape);
			if (pending === '\x1b' || pending === '\x1b[') break;
			if (!pending.startsWith('\x1b[')) {
				keyboard += pending[0];
				pending = pending.slice(1);
				continue;
			}
			const sequence = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(pending)?.[0]; // oxlint-disable-line no-control-regex -- Parse the terminal escape sequence prefix.
			if (sequence === undefined || sequence === '') {
				if (/^\x1b\[[0-?]*[ -/]*$/.test(pending)) break; // oxlint-disable-line no-control-regex -- Retain incomplete terminal escape sequences.
				keyboard += pending[0];
				pending = pending.slice(1);
				continue;
			}
			pending = pending.slice(sequence.length);
			if (sequence === '\x1b[200~') pasted = true;
			const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(sequence); // oxlint-disable-line no-control-regex -- Decode escape-prefixed terminal mouse reports.
			if (mouse && !pasted) {
				const button = Number(mouse[1]);
				// Ignore clicks, releases, motion, and horizontal wheel reports.
				if (sequence.endsWith('M') && (button & MOUSE_WHEEL_FLAG) !== 0 && (button & MOUSE_BUTTON_MASK) < 2) {
					const event: MouseWheelEvent = {direction: (button & 1) === 0 ? 'up' : 'down', x: Number(mouse[2]), y: Number(mouse[3])};
					for (const listener of listeners) listener(event);
				}
			} else keyboard += sequence;
			if (sequence === '\x1b[201~') pasted = false;
		}
		if (keyboard) stream.write(keyboard);
		if (pending) {
			// Preserve standalone Escape while allowing split CSI/mouse packets.
			flushTimer = setTimeout(() => {
				const remainder = pending;
				pending = '';
				flushTimer = undefined;
				if (!remainder.startsWith('\x1b[<')) stream.write(remainder);
			}, ESCAPE_FLUSH_DELAY_MS);
		}
	}

	function setRawMode(enabled: boolean) {
		if (active === enabled) return stream;
		active = enabled;
		source.setRawMode(enabled);
		if (enabled) {
			source.on('data', receive);
			mouseEnabled = Boolean(source.isTTY && stdout.isTTY);
			if (mouseEnabled) stdout.write(enableMouse);
		} else {
			source.off('data', receive);
			clearTimer();
			pending = '';
			pasted = false;
			if (mouseEnabled) stdout.write(disableMouse);
			mouseEnabled = false;
		}
		return stream;
	}

	const stdin = Object.assign(stream, {
		isTTY: source.isTTY,
		setRawMode,
		ref: () => {source.ref(); return stream;},
		unref: () => {source.unref(); return stream;},
	}) as unknown as NodeJS.ReadStream;
	return {
		stdin,
		subscribe: (listener: (event: MouseWheelEvent) => void) => {
			listeners.add(listener);
			return () => {listeners.delete(listener);};
		},
		dispose: () => {setRawMode(false); listeners.clear(); stream.destroy();},
	};
}
