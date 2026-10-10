import type {ChatRequest} from '@codeyantram/shared';

export type CliAgentId = 'ask' | 'build' | 'yolo';

export interface AgentSelection {
  id: CliAgentId;
  yoloActive: boolean;
}

/** Process-local authorization state. It is never hydrated from conversation or HTTP data. */
export class AgentSessionController {
  private selection: AgentSelection = Object.freeze({id: 'ask', yoloActive: false});
  private listeners = new Set<() => void>();

  constructor(private readonly automaticCapabilities: {patch: boolean; command: boolean},
    private readonly workspaceAvailable = true) {}

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  };

  readonly getSnapshot = (): AgentSelection => this.selection;

  select(id: 'ask' | 'build'): void {
    this.selection = Object.freeze({id, yoloActive: false});
    this.notify();
  }

  activateYolo(): void {
    this.selection = Object.freeze({id: 'yolo', yoloActive: true});
    this.notify();
  }

  matches(request: ChatRequest, selection: AgentSelection = this.selection): boolean {
    const id = request.agentId ?? 'ask';
    return id === selection.id && (id !== 'yolo' || selection.yoloActive);
  }

  authorize(request: ChatRequest, selection: AgentSelection = this.selection): {patch: boolean; command: boolean; automatic: boolean} {
    const active = this.matches(request, selection);
    const mutation = active && selection.id !== 'ask' && this.workspaceAvailable;
    const patch = mutation && (selection.id === 'build' || this.automaticCapabilities.patch);
    const command = mutation && (selection.id === 'build' || this.automaticCapabilities.command);
    return {patch, command,
      automatic: active && selection.id === 'yolo' && selection.yoloActive};
  }

  status(id: string): {available: boolean; patch: boolean; command: boolean} {
    const active = id === this.selection.id;
    const mutation = active && id !== 'ask' && this.workspaceAvailable;
    return {available: id !== 'yolo' || (active && this.selection.yoloActive),
      patch: mutation && (id === 'build' || this.automaticCapabilities.patch),
      command: mutation && (id === 'build' || this.automaticCapabilities.command)};
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
