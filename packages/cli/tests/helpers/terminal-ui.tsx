import type {ReactNode} from 'react';
import {PassThrough} from 'node:stream';
import {render, type Instance} from 'ink';
import {createTerminalInput} from '../../src/terminal/input.js';
import {MouseProvider} from '../../src/terminal/mouse.js';

const mounted: {app: Instance; exited: ReturnType<Instance['waitUntilExit']>; input: ReturnType<typeof createTerminalInput>}[] = [];

/** Exercise real Ink widgets with keyboard input and deterministic terminal dimensions. */
export function renderTerminal(node: ReactNode) {
	const stdout = Object.assign(new PassThrough(), {isTTY: true, columns: 100, rows: 40});
	const stdin = Object.assign(new PassThrough(), {isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {}});
	const input = createTerminalInput(stdin as unknown as NodeJS.ReadStream, stdout as unknown as NodeJS.WriteStream);
	let frame = '';
	stdout.on('data', chunk => {
		const text = String(chunk).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
		if (text.trim()) frame = text;
	});
	const app = render(<MouseProvider value={input}>{node}</MouseProvider>, {
		stdout: stdout as unknown as NodeJS.WriteStream, stdin: input.stdin, stderr: stdout as unknown as NodeJS.WriteStream,
		debug: true, interactive: true, patchConsole: false,
	});
	const exited = app.waitUntilExit();
	mounted.push({app, exited, input});
	return {stdin, exited, frame: () => frame, flush: () => app.waitUntilRenderFlush(), unmount: () => app.unmount()};
}

export async function cleanupTerminal() {
	for (const {app, exited, input} of mounted.splice(0)) {
		app.unmount();
		await exited;
		app.cleanup();
		input.dispose();
	}
}
