import React, {useSyncExternalStore} from 'react';
import {Box, useWindowSize} from 'ink';
import {StatusMessage} from '@inkjs/ui';
import type {EffortLevel} from '@codeyantram/shared';
import type {ChatSession} from '../chat/session.js';
import type {ModelPreferences} from '../models/preferences.js';
import {Conversation} from './conversation.js';
import {InputBar} from './input-bar.js';
import {StatusBar} from './status-bar.js';
import {getContextStatus} from '../chat/context.js';

export function ChatWorkspace({session, modelPreferences, effort, branch, onSelectModel}: {
	session: ChatSession;
	modelPreferences: ModelPreferences;
	effort?: EffortLevel;
	branch: string;
	onSelectModel: (id: string, effort?: EffortLevel) => Promise<void>;
}) {
	const {rows} = useWindowSize();
	const {messages, statusEntries, operation, isStreaming, compaction, error, notice} = useSyncExternalStore(session.subscribe, session.getSnapshot);
	const contextStatus = getContextStatus(modelPreferences.modelId, messages, compaction);
	const contextTurnCount = compaction
		? messages.slice(compaction.coveredMessageCount).filter(message => message.role === 'user').length
		: undefined;
	return (
		<Box flexDirection="column" height={rows}>
			<Conversation messages={messages} statusEntries={statusEntries} isStreaming={isStreaming} />
			<Box flexDirection="column" flexShrink={0}>
				{error && <StatusMessage variant="error">{error}</StatusMessage>}
				{notice && <StatusMessage variant="info">{notice}</StatusMessage>}
				<InputBar
					modelPreferences={modelPreferences}
					onSelectModel={onSelectModel}
					operation={operation}
					onSubmit={text => {void session.send(text, modelPreferences.modelId, effort);}}
					onCancel={() => session.cancel()}
					onClear={() => session.clear()}
					onCompact={() => {void session.compact(modelPreferences.modelId);}}
					onStatus={() => session.showStatus(modelPreferences.modelId)}
				/>
				<StatusBar branch={branch} model={modelPreferences.modelId} effort={effort} contextTurnCount={contextTurnCount} contextStatus={contextStatus} />
			</Box>
		</Box>
	);
}
