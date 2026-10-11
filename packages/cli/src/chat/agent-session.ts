import type {AgentApprovalPolicy, ChatRequest} from '@codeyantram/shared';

export type CliAgentId = string;

export interface AgentSelection {
  id: CliAgentId;
  yoloActive: boolean;
  approval?: AgentApprovalPolicy;
}

/** Process-local authorization state. It is never hydrated from conversation or HTTP data. */
export class AgentSessionController {
  private selection: AgentSelection = Object.freeze({id: 'ask', yoloActive: false});
  private invalid = false;
  private listeners = new Set<() => void>();

  constructor(private readonly automaticCapabilities: {patch: boolean; command: boolean},
    private readonly workspaceAvailable = true) {}

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  };

  readonly getSnapshot = (): AgentSelection => this.selection;

  select(id: string, approval: AgentApprovalPolicy = id === 'build' ? 'prompt' : 'none'): void {
    if (approval === 'automatic') throw new Error('Automatic agents require activation.');
    this.selection = Object.freeze({id, ...(id === 'ask' || id === 'build' ? {} : {approval}), yoloActive: false});
    this.invalid = false;
    this.notify();
  }

  activateYolo(id = 'yolo'): void {
    this.selection = Object.freeze({id, ...(id === 'yolo' ? {} : {approval: 'automatic' as const}), yoloActive: true});
    this.invalid = false;
    this.notify();
  }

  matches(request: ChatRequest, selection: AgentSelection = this.selection): boolean {
    const id = request.agentId ?? 'ask';
    return id === selection.id && (approvalFor(selection) !== 'automatic' || selection.yoloActive);
  }

  isValid(): boolean {return !this.invalid;}

  reconcile(approval: AgentApprovalPolicy | undefined): void {
    this.invalid = approval === undefined || approval !== approvalFor(this.selection);
    this.notify();
  }

  authorize(request: ChatRequest, selection: AgentSelection = this.selection): {patch: boolean; command: boolean; automatic: boolean} {
    const active = this.matches(request, selection);
    const approval = approvalFor(selection);
    const mutation = active && approval !== 'none' && this.workspaceAvailable;
    const patch = mutation && (approval === 'prompt' || this.automaticCapabilities.patch);
    const command = mutation && (approval === 'prompt' || this.automaticCapabilities.command);
    return {patch, command,
      automatic: active && approval === 'automatic' && selection.yoloActive};
  }

  status(id: string, declaredApproval?: AgentApprovalPolicy): {available: boolean; patch: boolean; command: boolean} {
    const active = id === this.selection.id;
    const approval = declaredApproval ?? approvalFor(active ? this.selection : {id, yoloActive: false});
    const mutation = this.workspaceAvailable && approval !== 'none';
    return {available: approval !== 'automatic' || (active && this.selection.yoloActive),
      patch: mutation && (approval === 'prompt' || this.automaticCapabilities.patch),
      command: mutation && (approval === 'prompt' || this.automaticCapabilities.command)};
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

function approvalFor(selection: AgentSelection): AgentApprovalPolicy {
  if (selection.approval !== undefined) return selection.approval;
  if (selection.id === 'build') return 'prompt';
  if (selection.id === 'yolo') return 'automatic';
  return 'none';
}
