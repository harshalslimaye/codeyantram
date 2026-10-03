import {EventEmitter} from 'node:events';
import type {Response} from 'express';
import {describe, expect, it, vi} from 'vitest';
import {writeStreamEvent} from '../../src/http/sse.js';

function responseStub() {
  const response = Object.assign(new EventEmitter(), {write: vi.fn().mockReturnValue(false)});
  return {response, typed: response as unknown as Response};
}

describe('writeStreamEvent', () => {
  it('escapes embedded newlines and waits for drain before continuing', async () => {
    const {response, typed} = responseStub();
    const writing = writeStreamEvent(typed, {type: 'text-delta', text: 'Hello\n\ndata: world'}, new AbortController().signal);
    expect(response.write).toHaveBeenCalledWith('data: {"type":"text-delta","text":"Hello\\n\\ndata: world"}\n\n');
    expect(response.listenerCount('drain')).toBe(1);
    response.emit('drain');
    await writing;
    expect(response.listenerCount('drain')).toBe(0);
  });

  it('releases backpressure waits when the client disconnects', async () => {
    const {response, typed} = responseStub();
    const controller = new AbortController();
    const writing = writeStreamEvent(typed, {type: 'start', messageId: 'assistant-1'}, controller.signal);
    const rejected = expect(writing).rejects.toMatchObject({name: 'AbortError'});
    controller.abort();
    await rejected;
    expect(response.listenerCount('drain')).toBe(0);
  });

  it('does not write after cancellation', async () => {
    const {response, typed} = responseStub();
    await expect(writeStreamEvent(typed, {type: 'done', durationMs: 1}, AbortSignal.abort()))
      .rejects.toMatchObject({name: 'AbortError'});
    expect(response.write).not.toHaveBeenCalled();
  });
});
