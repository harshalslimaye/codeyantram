import React, {useEffect} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';
import {Picker} from './picker.js';
import {useKeyboardOwner} from '../keyboard/provider.js';
import {useTheme} from '../theme/provider.js';
import type {AgentSessionController} from '../chat/agent-session.js';
import type {AgentMetadata} from '@codeyantram/shared';

const LABEL_MARGIN = 8;

function label(agent: AgentMetadata, width: number): string {
  let availability = 'available';
  if (!agent.available) availability = agent.id === 'yolo' ? 'activate' : 'unavailable';
  const description = `${agent.name} · ${agent.source} · ${agent.approval} · ${availability} · ${agent.tools.length} tools · ${agent.description}`;
  return description.length > width ? `${description.slice(0, Math.max(1, width - 1))}…` : description;
}

export function AgentPicker({session, agents, refresh}: {session: AgentSessionController;
  agents: readonly AgentMetadata[]; refresh?: () => Promise<void>}) {
  const {owner, pop, push} = useKeyboardOwner();
  const {columns} = useWindowSize();
  const {setNotice} = useTheme();
  useEffect(() => {if (owner === 'agent-picker') void refresh?.().catch(() => {});}, [owner, refresh]);
  const options = agents.map(agent => ({value: agent.id, label: label(agent, Math.max(1, columns - LABEL_MARGIN))}));
  return <>
    {owner === 'agent-picker' && <Picker owner="agent-picker" title="Choose an agent for the next turn"
      options={options} onSelect={id => {
        const selected = agents.find(agent => agent.id === id);
        if (selected === undefined || (!selected.available && id !== 'yolo')) {
          setNotice('That agent is unavailable in this session.', 'error');
          return;
        }
        if (id !== 'ask' && id !== 'build' && id !== 'yolo') {
          setNotice('This CLI cannot select that agent yet.', 'error');
          return;
        }
        pop('agent-picker');
        if (id === 'yolo') push('yolo-confirmation');
        else session.select(id);
        void refresh?.().catch(() => {});
      }} onCancel={() => pop('agent-picker')} />}
    {owner === 'yolo-confirmation' && <YoloConfirmation session={session} />}
  </>;
}

function YoloConfirmation({session}: {session: AgentSessionController}) {
  const {palette} = useTheme();
  const {isOwner, pop} = useKeyboardOwner();
  useInput((input, key) => {
    if (!isOwner('yolo-confirmation')) return;
    if (key.escape || input.toLowerCase() === 'd') {pop('yolo-confirmation'); return;}
    if (input.toLowerCase() === 'a') {
      session.activateYolo();
      pop('yolo-confirmation');
    }
  }, {isActive: true});
  return <Box flexDirection="column" borderStyle="round" borderColor={palette.border} paddingX={1} width="100%">
    <Text bold color={palette.primary}>Activate Yolo for this CLI session?</Text>
    <Text color={palette.text}>Patches and commands will run without individual approval. Bash is not sandboxed.</Text>
    <Text color={palette.muted}>A activate · D or Esc cancel</Text>
  </Box>;
}
