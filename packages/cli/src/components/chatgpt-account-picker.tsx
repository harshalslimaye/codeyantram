import React from 'react';
import {Picker} from './picker.js';
import {useKeyboardOwner} from '../keyboard/provider.js';
import type {ChatGPTAccount} from '../chat/chatgpt.js';

export function ChatGPTAccountPicker({accounts, onSelect}: {
  accounts: readonly ChatGPTAccount[];
  onSelect: (id: string) => void;
}) {
  const {pop} = useKeyboardOwner();
  return <Picker owner="chatgpt-account-picker" title="Choose a ChatGPT account · Enter select · Esc close"
    options={accounts.map(account => ({value: account.id, label: `${account.email ?? account.id} · ${account.id}`}))}
    onSelect={id => {pop('chatgpt-account-picker'); onSelect(id);}}
    onCancel={() => pop('chatgpt-account-picker')} />;
}
