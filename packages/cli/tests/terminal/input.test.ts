import {PassThrough} from 'node:stream';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createTerminalInput} from '../../src/terminal/input.js';

const inputs: ReturnType<typeof createTerminalInput>[] = [];
afterEach(() => {for (const input of inputs.splice(0)) input.dispose(); vi.useRealTimers();});

function setup(isTTY = true) {
	const source = Object.assign(new PassThrough(), {isTTY, setRawMode: vi.fn<(enabled: boolean) => void>(), ref: vi.fn<() => void>(), unref: vi.fn<() => void>()});
	const stdout = Object.assign(new PassThrough(), {isTTY});
	let output = '';
	stdout.on('data', chunk => {output += String(chunk);});
	const input = createTerminalInput(source as unknown as NodeJS.ReadStream, stdout as unknown as NodeJS.WriteStream);
	inputs.push(input);
	let keyboard = '';
	input.stdin.on('data', chunk => {keyboard += String(chunk);});
	const wheel = vi.fn<Parameters<ReturnType<typeof createTerminalInput>["subscribe"]>[0]>();
	input.subscribe(wheel);
	input.stdin.setRawMode(true);
	return {source, input, wheel, output: () => output, keyboard: () => keyboard};
}

describe('terminal mouse and keyboard input', () => {
	it('accepts sources that already decode text as UTF-8 strings', () => {
		const ui = setup();
		ui.source.setEncoding('utf8');
		ui.source.write('Hello 👋\x1b[<64;2;3M');
		expect(ui.keyboard()).toBe('Hello 👋');
		expect(ui.wheel).toHaveBeenCalledExactlyOnceWith({direction: 'up', x: 2, y: 3});
	});
	it('preserves Alt keys and malformed escape sequences as keyboard input', () => {
		const ui = setup();
		ui.source.write('\x1bx\x1b[\x01');
		expect(ui.keyboard()).toBe('\x1bx\x1b[\x01');
		expect(ui.wheel).not.toHaveBeenCalled();
	});

	it('retains a split CSI prefix until the rest of the arrow key arrives', () => {
		const ui = setup();
		ui.source.write('\x1b[');
		expect(ui.keyboard()).toBe('');
		ui.source.write('A');
		expect(ui.keyboard()).toBe('\x1b[A');
	});
	it('separates multiple wheel packets and clicks from ordinary text and arrow keys', () => {
		const ui = setup();
		ui.source.write('draft\x1b[<64;2;3M\x1b[<65;4;5M\x1b[<0;4;5M\x1b[<0;4;5m\x1b[A');
		expect(ui.wheel.mock.calls).toEqual([
			[{direction: 'up', x: 2, y: 3}], [{direction: 'down', x: 4, y: 5}],
		]);
		expect(ui.keyboard()).toBe('draft\x1b[A');
	});

	it('decodes packets split at any byte without leaking mouse escape text to the prompt', () => {
		const ui = setup();
		for (const character of '\x1b[<80;12;8M') ui.source.write(character);
		expect(ui.wheel).toHaveBeenCalledExactlyOnceWith({direction: 'up', x: 12, y: 8});
		expect(ui.keyboard()).toBe('');
	});

	it('preserves split Unicode, bracketed paste, and mouse-like text inside a paste', () => {
		const ui = setup();
		const bytes = Buffer.from('👋');
		ui.source.write(bytes.subarray(0, 2));
		ui.source.write(bytes.subarray(2));
		const paste = '\x1b[200~literal \x1b[<64;2;3M\x1b[201~';
		for (const character of paste) ui.source.write(character);
		expect(ui.keyboard()).toBe('👋' + paste);
		expect(ui.wheel).not.toHaveBeenCalled();
	});

	it('forwards standalone Escape and discards abandoned mouse reports', () => {
		vi.useFakeTimers();
		const ui = setup();
		ui.source.write('\x1b');
		vi.advanceTimersByTime(30);
		expect(ui.keyboard()).toBe('\x1b');
		ui.source.write('\x1b[<64;');
		vi.advanceTimersByTime(30);
		expect(ui.keyboard()).toBe('\x1b');
		expect(ui.wheel).not.toHaveBeenCalled();
	});

	it('restores mouse reporting and raw mode on cleanup, removes listeners, and clears pending timers', () => {
		vi.useFakeTimers();
		const ui = setup();
		expect(ui.output()).toBe('\x1b[?1000h\x1b[?1006h');
		ui.source.write('\x1b[<64;');
		ui.input.dispose();
		expect(ui.source.setRawMode.mock.calls).toEqual([[true], [false]]);
		expect(ui.source.listenerCount('data')).toBe(0);
		expect(ui.output()).toBe('\x1b[?1000h\x1b[?1006h\x1b[?1006l\x1b[?1000l');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not emit terminal mouse-mode controls for non-TTY streams', () => {
		const ui = setup(false);
		ui.source.write('ordinary input');
		expect(ui.keyboard()).toBe('ordinary input');
		ui.input.dispose();
		expect(ui.output()).toBe('');
	});
});
