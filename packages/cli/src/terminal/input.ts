import {PassThrough} from 'node:stream';
import {StringDecoder} from 'node:string_decoder';

const MOUSE_WHEEL_FLAG = 64;
const VERTICAL_WHEEL_BUTTON_COUNT = 2;

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
  return new TerminalInputAdapter(source, stdout).interface();
}

class TerminalInputAdapter {
  private readonly stream = new PassThrough();
  private readonly listeners = new Set<(event: MouseWheelEvent) => void>();
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';
  private pasted = false;
  private active = false;
  private mouseEnabled = false;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly source: NodeJS.ReadStream, private readonly stdout: NodeJS.WriteStream) {}

  private clearTimer() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
  }

  private receive = (chunk: Buffer | string) => {
    this.clearTimer();
    this.pending += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    const keyboard = this.consume();
    if (keyboard) this.stream.write(keyboard);
    if (this.pending) {
      // Preserve standalone Escape while allowing split CSI/mouse packets.
      this.flushTimer = setTimeout(() => {
        const remainder = this.pending;
        this.pending = '';
        this.flushTimer = undefined;
        if (!remainder.startsWith('\x1b[<')) this.stream.write(remainder);
      }, ESCAPE_FLUSH_DELAY_MS);
    }
  };

  private consume(): string {
    let keyboard = '';
    while (this.pending) {
      const escape = this.pending.indexOf('\x1b');
      if (escape === -1) {
        keyboard += this.pending;
        this.pending = '';
        break;
      }
      keyboard += this.pending.slice(0, escape);
      this.pending = this.pending.slice(escape);
      const result = this.consumeEscape();
      keyboard += result.keyboard;
      if (result.wait) break;
    }
    return keyboard;
  }

  private consumeEscape(): {keyboard: string; wait: boolean} {
    if (this.pending === '\x1b' || this.pending === '\x1b[') return {keyboard: '', wait: true};
    if (!this.pending.startsWith('\x1b[')) return this.consumeCharacter();
    const sequence = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(this.pending)?.[0]; // oxlint-disable-line no-control-regex -- Parse the terminal escape sequence prefix.
    if (sequence === undefined || sequence === '') {
      if (/^\x1b\[[0-?]*[ -/]*$/.test(this.pending)) return {keyboard: '', wait: true}; // oxlint-disable-line no-control-regex -- Retain incomplete terminal escape sequences.
      return this.consumeCharacter();
    }
    this.pending = this.pending.slice(sequence.length);
    return {keyboard: this.consumeSequence(sequence), wait: false};
  }

  private consumeCharacter(): {keyboard: string; wait: boolean} {
    const keyboard = this.pending[0];
    this.pending = this.pending.slice(1);
    return {keyboard, wait: false};
  }

  private consumeSequence(sequence: string): string {
    if (sequence === '\x1b[200~') this.pasted = true;
    const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(sequence); // oxlint-disable-line no-control-regex -- Decode escape-prefixed terminal mouse reports.
    let keyboard = '';
    if (mouse && !this.pasted) this.dispatchMouse(mouse, sequence);
    else keyboard = sequence;
    if (sequence === '\x1b[201~') this.pasted = false;
    return keyboard;
  }

  private dispatchMouse(mouse: RegExpExecArray, sequence: string) {
    const button = Number(mouse[1]);
    // Ignore clicks, releases, motion, and horizontal wheel reports.
    if (sequence.endsWith('M') && (button & MOUSE_WHEEL_FLAG) !== 0 && (button & MOUSE_BUTTON_MASK) < VERTICAL_WHEEL_BUTTON_COUNT) {
      const event: MouseWheelEvent = {direction: (button & 1) === 0 ? 'up' : 'down', x: Number(mouse[2]), y: Number(mouse[3])};
      for (const listener of this.listeners) listener(event);
    }
  }

  private setRawMode(enabled: boolean) {
    if (this.active === enabled) return this.stream;
    this.active = enabled;
    this.source.setRawMode(enabled);
    if (enabled) {
      this.source.on('data', this.receive);
      this.mouseEnabled = Boolean(this.source.isTTY && this.stdout.isTTY);
      if (this.mouseEnabled) this.stdout.write(enableMouse);
    } else {
      this.source.off('data', this.receive);
      this.clearTimer();
      this.pending = '';
      this.pasted = false;
      if (this.mouseEnabled) this.stdout.write(disableMouse);
      this.mouseEnabled = false;
    }
    return this.stream;
  }

  interface() {
    const stdin = Object.assign(this.stream, {
      isTTY: this.source.isTTY,
      setRawMode: (enabled: boolean) => this.setRawMode(enabled),
      ref: () => {this.source.ref(); return this.stream;},
      unref: () => {this.source.unref(); return this.stream;},
    }) as unknown as NodeJS.ReadStream;
    return {
      stdin,
      subscribe: (listener: (event: MouseWheelEvent) => void) => {
        this.listeners.add(listener);
        return () => {this.listeners.delete(listener);};
      },
      dispose: () => {this.setRawMode(false); this.listeners.clear(); this.stream.destroy();},
    };
  }
}
