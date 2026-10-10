import React from 'react';
import {Box, Text, useInput} from 'ink';
import {Picker} from './picker.js';
import {useKeyboardOwner} from '../keyboard/provider.js';
import {useTheme} from '../theme/provider.js';
import type {AgentSessionController, CliAgentId} from '../chat/agent-session.js';

const OPTIONS: {value: CliAgentId; label: string}[] = [
  {value: 'ask', label: 'Ask     Read and investigate'},
  {value: 'build', label: 'Build   Review each patch and command'},
  {value: 'yolo', label: 'Yolo    Run patches and commands automatically after activation'},
];

export function AgentPicker({session}: {session: AgentSessionController}) {
  const {owner, pop, push} = useKeyboardOwner();
  return <>
    {owner === 'agent-picker' && <Picker owner="agent-picker" title="Choose an agent for the next turn"
      options={OPTIONS} onSelect={id => {
        pop('agent-picker');
        if (id === 'yolo') push('yolo-confirmation');
        else session.select(id);
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
