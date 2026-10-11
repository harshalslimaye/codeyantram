import React, {useEffect, useState} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';
import {Picker} from './picker.js';
import {useKeyboardOwner} from '../keyboard/provider.js';
import {useTheme} from '../theme/provider.js';
import type {AgentSessionController} from '../chat/agent-session.js';
import type {AgentMetadata} from '@codeyantram/shared';

const LABEL_MARGIN = 8;
const MAX_DIAGNOSTICS_SHOWN = 3;

function label(agent: AgentMetadata, width: number): string {
  let availability = 'available';
  if (!agent.available) availability = agent.id === 'yolo' ? 'activate' : 'unavailable';
  const description = `${agent.name} · ${agent.source} · ${agent.approval} · ${availability} · ${agent.tools.length} tools · ${agent.description}`;
  return description.length > width ? `${description.slice(0, Math.max(1, width - 1))}…` : description;
}

export function AgentPicker({session, agents, diagnostics = [], refresh}: {session: AgentSessionController;
  agents: readonly AgentMetadata[]; diagnostics?: readonly string[]; refresh?: () => Promise<void>}) {
  const {owner, pop, push} = useKeyboardOwner();
  const {columns} = useWindowSize();
  const {setNotice} = useTheme();
  const [pendingAutomatic, setPendingAutomatic] = useState('yolo');
  useEffect(() => {if (owner === 'agent-picker') void refresh?.().catch(() => {});}, [owner, refresh]);
  const options = agents.map(agent => ({value: agent.id, label: label(agent, Math.max(1, columns - LABEL_MARGIN))}));
  return <>
    {owner === 'agent-picker' && diagnostics.slice(0, MAX_DIAGNOSTICS_SHOWN).map(message => <Text key={message} color="yellow">{message.slice(0, Math.max(1, columns - LABEL_MARGIN))}</Text>)}
    {owner === 'agent-picker' && <Picker owner="agent-picker" title="Choose an agent for the next turn"
      options={options} onSelect={id => {
        const selected = agents.find(agent => agent.id === id);
        if (selected === undefined || (!selected.available && selected.approval !== 'automatic')) {
          setNotice('That agent is unavailable in this session.', 'error');
          return;
        }
        pop('agent-picker');
        if (selected.approval === 'automatic') {setPendingAutomatic(id); push('yolo-confirmation');}
        else session.select(id, selected.approval);
        void refresh?.().catch(() => {});
      }} onCancel={() => pop('agent-picker')} />}
    {owner === 'yolo-confirmation' && <YoloConfirmation session={session} id={pendingAutomatic} />}
  </>;
}

function YoloConfirmation({session, id}: {session: AgentSessionController; id: string}) {
  const {palette} = useTheme();
  const {isOwner, pop} = useKeyboardOwner();
  useInput((input, key) => {
    if (!isOwner('yolo-confirmation')) return;
    if (key.escape || input.toLowerCase() === 'd') {pop('yolo-confirmation'); return;}
    if (input.toLowerCase() === 'a') {
      session.activateYolo(id);
      pop('yolo-confirmation');
    }
  }, {isActive: true});
  return <Box flexDirection="column" borderStyle="round" borderColor={palette.border} paddingX={1} width="100%">
    <Text bold color={palette.primary}>Activate {id === 'yolo' ? 'Yolo' : id} for this CLI session?</Text>
    <Text color={palette.text}>Patches and commands will run without individual approval. Bash is not sandboxed.</Text>
    <Text color={palette.muted}>A activate · D or Esc cancel</Text>
  </Box>;
}
