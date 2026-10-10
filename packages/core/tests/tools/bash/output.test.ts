import {describe, expect, it} from 'vitest';
import {captureCommandOutput, createCommandCapture, finishCommandOutput} from '../../../src/tools/bash/output.js';

describe('bounded command output', () => {
  it('decodes split UTF-8 chunks without splitting Unicode at the retained byte boundary', () => {
    const capture = createCommandCapture();
    const emoji = Buffer.from('😀');
    captureCommandOutput(capture, 'stdout', emoji.subarray(0, 2));
    captureCommandOutput(capture, 'stdout', emoji.subarray(2));
    captureCommandOutput(capture, 'stderr', Buffer.from('error'));
    expect(finishCommandOutput(capture)).toEqual({stdout: '😀', stderr: 'error', truncated: false});
    const large = createCommandCapture();
    captureCommandOutput(large, 'stdout', Buffer.from('a'.repeat(11999) + '😀'));
    expect(finishCommandOutput(large)).toEqual({stdout: 'a'.repeat(11999), stderr: '', truncated: true});
  });

  it('bounds capture across both streams, separately from total process output', () => {
    const capture = createCommandCapture();
    expect(captureCommandOutput(capture, 'stdout', Buffer.alloc(6000, 'a'))).toBe(false);
    expect(captureCommandOutput(capture, 'stderr', Buffer.alloc(6001, 'b'))).toBe(false);
    expect(finishCommandOutput(capture)).toEqual({stdout: 'a'.repeat(6000), stderr: 'b'.repeat(6000), truncated: true});
    expect(capture.capturedBytes).toBe(12000);
    expect(captureCommandOutput(capture, 'stdout', Buffer.alloc(8_388_609, 'c'))).toBe(true);
    expect(capture.capturedBytes).toBe(12000);
  });

  it('handles malformed UTF-8 as untrusted text and accounts for JSON escaping', () => {
    const invalid = createCommandCapture();
    captureCommandOutput(invalid, 'stdout', Buffer.from([0xff]));
    expect(finishCommandOutput(invalid).stdout).toBe('�');
    const control = createCommandCapture();
    captureCommandOutput(control, 'stdout', Buffer.alloc(12000));
    const output = finishCommandOutput(control);
    expect(output.truncated).toBe(true);
    expect(output.stdout).toHaveLength(8000);
    expect(Buffer.byteLength(JSON.stringify(output), 'utf8')).toBeLessThan(49000);
  });
});
