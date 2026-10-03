import React, {useSyncExternalStore} from 'react';
import {Box, useWindowSize} from 'ink';
import {StatusMessage} from '@inkjs/ui';
import type {EffortLevel} from '@codeyantram/shared';
import type {ChatSession} from '../chat/session.js';
import type {ModelPreferences} from '../models/preferences.js';
import {Conversation} from './conversation.js';
import {InputBar} from './input-bar.js';
import {StatusBar} from './status-bar.js';

export function ChatWorkspace({session, modelPreferences, effort, branch, onSelectModel}: {
	session: ChatSession;
	modelPreferences: ModelPreferences;
	effort?: EffortLevel;
	branch: string;
	onSelectModel: (id: string, effort?: EffortLevel) => Promise<void>;
}) {
	const {rows} = useWindowSize();
	const {messages, isStreaming, error, notice} = useSyncExternalStore(session.subscribe, session.getSnapshot);
	return (
		<Box flexDirection="column" height={rows}>
			<Conversation messages={messages} isStreaming={isStreaming} />
			{error && <StatusMessage variant="error">{error}</StatusMessage>}
			{notice && <StatusMessage variant="info">{notice}</StatusMessage>}
			<InputBar
				modelPreferences={modelPreferences}
				onSelectModel={onSelectModel}
				isStreaming={isStreaming}
				onSubmit={text => {void session.send(text, modelPreferences.modelId, effort);}}
				onCancel={() => session.cancel()}
				onClear={() => session.clear()}
			/>
			<StatusBar branch={branch} model={modelPreferences.modelId} effort={effort} />
		</Box>
	);
}
