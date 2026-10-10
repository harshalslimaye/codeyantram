import {describe, expect, it, vi} from 'vitest';
import type {ChatRequest} from '@codeyantram/shared';
import {AgentSessionController} from '../../src/chat/agent-session.js';

const request = (agentId?: ChatRequest['agentId']): ChatRequest => ({model: 'gpt-6.1-sol',
  ...(agentId === undefined ? {} : {agentId}),
  messages: [{id: 'u1', role: 'user', parts: [{type: 'text', text: 'Check this.'}]}]});

describe('host-owned agent selection', () => {
  it('starts in Ask, requires deliberate Yolo activation, and resets when switching away', () => {
    const first = new AgentSessionController({patch: true, command: true});
    const changed = vi.fn<() => void>();
    first.subscribe(changed);
    expect(first.getSnapshot()).toEqual({id: 'ask', yoloActive: false});
    expect(first.matches(request('yolo'))).toBe(false);
    first.select('build');
    expect(first.matches(request('build'))).toBe(true);
    first.activateYolo();
    expect(first.matches(request('yolo'))).toBe(true);
    first.select('ask');
    expect(first.matches(request('yolo'))).toBe(false);
    expect(new AgentSessionController({patch: true, command: true}).getSnapshot()).toEqual({id: 'ask', yoloActive: false});
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it('caps automatic patching and commands independently and preserves a turn snapshot', () => {
    const session = new AgentSessionController({patch: true, command: false});
    session.activateYolo();
    const snapshot = session.getSnapshot();
    expect(session.authorize(request('yolo'), snapshot)).toEqual({patch: true, command: false, automatic: true});
    expect(session.status('yolo')).toEqual({available: true, patch: true, command: false});
    session.select('build');
    expect(session.authorize(request('yolo'), snapshot)).toEqual({patch: true, command: false, automatic: true});
    expect(session.authorize(request('yolo'))).toEqual({patch: false, command: false, automatic: false});
  });
});
