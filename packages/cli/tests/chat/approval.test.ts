import {describe, expect, it, vi} from 'vitest';
import {ApprovalController} from '../../src/chat/approval.js';
import {approvalText} from '../../src/components/approval-view.js';
import {requireValue} from '../../../shared/tests/helpers.js';

const patch = {patchText: '*** Begin Patch\n*** Add File: hello.txt\n+hello\n*** End Patch', objective: 'Add a greeting',
  changes: [{filePath: 'hello.txt', action: 'add' as const, beforeHash: null, afterHash: 'a'.repeat(64)}]};
const command = {command: 'npm test', workdir: '.', timeoutMs: 1200, objective: 'Run tests'};

describe('CLI approval controller', () => {
  it('serializes exact patch and command requests and binds decisions to the current ID', async () => {
    const controller = new ApprovalController();
    const changed = vi.fn<() => void>();
    controller.subscribe(changed);
    const first = controller.approvePatch(patch);
    const firstItem = requireValue(controller.getSnapshot());
    expect(firstItem?.kind).toBe('patch');
    expect(approvalText(firstItem)).toContain(patch.patchText);
    expect(approvalText(firstItem)).toContain(requireValue(patch.changes[0]).afterHash);
    const second = controller.approveCommand(command);
    expect(controller.getSnapshot()?.id).toBe(firstItem?.id);
    controller.decide(firstItem.id + 1, true);
    expect(controller.getSnapshot()?.id).toBe(firstItem?.id);
    controller.decide(firstItem.id, false);
    expect(await first).toBe(false);
    const secondItem = requireValue(controller.getSnapshot());
    expect(secondItem?.kind).toBe('command');
    expect(approvalText(secondItem)).toContain(command.command);
    controller.decide(secondItem.id, true);
    expect(await second).toBe(true);
    expect(controller.getSnapshot()).toBeUndefined();
    expect(changed).toHaveBeenCalledTimes(4);
  });

  it('denies aborted and shutdown requests without leaving waiters pending', async () => {
    const controller = new ApprovalController();
    const abort = new AbortController();
    const first = controller.approvePatch(patch, abort.signal);
    const second = controller.approveCommand(command);
    abort.abort();
    expect(await first).toBe(false);
    expect(controller.getSnapshot()?.kind).toBe('command');
    controller.close();
    expect(await second).toBe(false);
    expect(await controller.approvePatch(patch)).toBe(false);
  });
});
