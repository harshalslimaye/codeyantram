import React, {useState, useSyncExternalStore} from 'react';
import {Box, useWindowSize} from 'ink';
import {StatusMessage} from '@inkjs/ui';
import type {AgentMetadata, ConnectableProvider, EffortLevel, ModelPreferences} from '@codeyantram/shared';
import type {ChatSession} from '../chat/session.js';
import {Conversation} from './conversation.js';
import {InputBar} from './input-bar.js';
import {StatusBar} from './status-bar.js';
import {getContextStatus} from '../chat/context.js';
import type {ApprovalController} from '../chat/approval.js';
import {ApprovalView} from './approval-view.js';
import {AgentSessionController} from '../chat/agent-session.js';
import {FALLBACK_AGENT_METADATA} from '../chat/agent-catalog.js';
import {useTheme} from '../theme/provider.js';
import type {ChatGPTAccount, ChatGPTAccountModel} from '../chat/chatgpt.js';

// oxlint-disable-next-line eslint/max-lines-per-function, eslint/complexity -- The workspace renders the conversation and input together.
export function ChatWorkspace({session, approvals, agentSession, availableAgents = FALLBACK_AGENT_METADATA, agentDiagnostics, refreshAgents, reloadAgents, modelPreferences, effort, branch, onSelectModel, chatgptModels = [], onChatGPTCommand, onLoadChatGPTAccounts, onSaveProviderKey}: {
	session: ChatSession;
	approvals?: ApprovalController;
	agentSession?: AgentSessionController;
	availableAgents?: readonly AgentMetadata[];
	agentDiagnostics?: readonly string[];
	refreshAgents?: () => Promise<void>;
	reloadAgents?: () => Promise<readonly {filePath?: string; message: string}[]>;
	modelPreferences: ModelPreferences;
	effort?: EffortLevel;
	branch: string;
	onSelectModel: (id: string, effort?: EffortLevel) => Promise<void>;
	chatgptModels?: readonly ChatGPTAccountModel[];
	onChatGPTCommand?: (command: string, profileId?: string, signal?: AbortSignal) => Promise<string>;
	onLoadChatGPTAccounts?: () => Promise<ChatGPTAccount[]>;
	onSaveProviderKey?: (provider: ConnectableProvider, apiKey: string) => Promise<void>;
}) {
	const {rows} = useWindowSize();
	const {setNotice} = useTheme();
	const {agents, selectedAgent} = useAgentSelection(agentSession);
	const {messages, statusEntries, operation, isStreaming, compaction, error, notice} = useSyncExternalStore(session.subscribe, session.getSnapshot);
	const pending = useSyncExternalStore(approvals?.subscribe ?? emptySubscribe, approvals?.getSnapshot ?? noApproval);
	const contextStatus = getContextStatus(modelPreferences.modelId, messages, compaction,
		chatgptModels.find(model => model.id === modelPreferences.modelId)?.contextWindow);
	const contextTurnCount = compactionTurnCount(compaction, messages);
	return (
		<Box flexDirection="column" height={rows}>
			<ReviewOrConversation approvals={approvals} pending={pending} session={session}
				messages={messages} statusEntries={statusEntries} isStreaming={isStreaming} />
			<Box flexDirection="column" flexShrink={0}>
				{(error !== undefined && error !== '') && <StatusMessage variant="error">{error}</StatusMessage>}
				{(notice !== undefined && notice !== '') && <StatusMessage variant="info">{notice}</StatusMessage>}
				<InputBar
					modelPreferences={modelPreferences}
					chatgptModels={chatgptModels}
					onChatGPTCommand={onChatGPTCommand}
					onLoadChatGPTAccounts={onLoadChatGPTAccounts}
					onSaveProviderKey={onSaveProviderKey}
					agentSession={agents}
					availableAgents={availableAgents}
					agentDiagnostics={agentDiagnostics}
					refreshAgents={refreshAgents}
					reloadAgents={reloadAgents}
					onSelectModel={onSelectModel}
					operation={operation}
					onSubmit={text => {
						if (selectedAgent.id !== 'ask' && !availableAgents.some(agent => agent.id === selectedAgent.id)) {
							setNotice('Selected agent is unavailable. Choose another with /agent.', 'error');
							return;
						}
						void session.send(text, modelPreferences.modelId, effort,
							selectedAgent.id === 'ask' ? undefined : selectedAgent.id);
					}}
					onCancel={() => session.cancel()}
					onExport={filePath => {void session.exportMarkdown(filePath);}}
					onClear={() => session.clear()}
					onCompact={() => {void session.compact(modelPreferences.modelId);}}
					onStatus={() => session.showStatus(modelPreferences.modelId)}
					onInit={() => {void session.initialize();}}
				/>
				<StatusBar branch={branch} agent={selectedAgent.id} automaticActive={selectedAgent.yoloActive} model={modelPreferences.modelId} openaiConnection={modelPreferences.openaiConnection} effort={effort} contextTurnCount={contextTurnCount} contextStatus={contextStatus} />
			</Box>
		</Box>
	);
}

const emptySubscribe = () => () => {};
const noApproval = () => null;

function useAgentSelection(agentSession?: AgentSessionController) {
	const [localAgentSession] = useState(() => new AgentSessionController({patch: false, command: false}));
	const agents = agentSession ?? localAgentSession;
	const selectedAgent = useSyncExternalStore(agents.subscribe, agents.getSnapshot);
	return {agents, selectedAgent};
}

function ReviewOrConversation({approvals, pending, session, messages, statusEntries, isStreaming}: {
	approvals?: ApprovalController;
	pending: ReturnType<ApprovalController['getSnapshot']> | null;
	session: ChatSession;
	messages: ReturnType<ChatSession['getSnapshot']>['messages'];
	statusEntries: ReturnType<ChatSession['getSnapshot']>['statusEntries'];
	isStreaming: boolean;
}) {
	return pending && approvals ? <ApprovalView key={pending.id} controller={approvals} item={pending} onCancel={() => session.cancel()} /> :
		<Conversation messages={messages} statusEntries={statusEntries} isStreaming={isStreaming} />;
}

function compactionTurnCount(compaction: ReturnType<ChatSession['getSnapshot']>['compaction'],
	messages: ReturnType<ChatSession['getSnapshot']>['messages']): number | undefined {
	return compaction ? messages.slice(compaction.coveredMessageCount).filter(message => message.role === 'user').length : undefined;
}
