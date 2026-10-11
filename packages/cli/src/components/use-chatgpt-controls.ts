import {useState} from 'react';
import {useKeyboardOwner} from '../keyboard/provider.js';
import {useTheme} from '../theme/provider.js';
import type {ChatGPTAccount} from '../chat/chatgpt.js';

export function useChatGPTControls({onCommand, onLoadAccounts}: {
  onCommand?: (command: string, profileId?: string, signal?: AbortSignal) => Promise<string>;
  onLoadAccounts?: () => Promise<ChatGPTAccount[]>;
}) {
  const {push} = useKeyboardOwner();
  const {setNotice} = useTheme();
  const [isRunning, setIsRunning] = useState(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [accounts, setAccounts] = useState<ChatGPTAccount[]>([]);
  const [authAbort, setAuthAbort] = useState<AbortController | null>(null);

  async function run(command: string, profileId?: string) {
    if (!onCommand || authAbort !== null) {setNotice('ChatGPT login is unavailable.', 'error'); return;}
    const controller = new AbortController();
    setAuthAbort(controller);
    setIsRunning(true);
    try {setNotice(await onCommand(command, profileId, controller.signal));}
    catch (error) {if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : 'ChatGPT command failed.', 'error');}
    finally {setAuthAbort(null); setIsRunning(false);}
  }

  async function openAccountPicker() {
    if (!onLoadAccounts) {setNotice('ChatGPT accounts are unavailable.', 'error'); return;}
    setIsLoadingAccounts(true);
    try {
      const next = await onLoadAccounts();
      if (next.length === 0) {setNotice('No connected ChatGPT account. Use /chatgpt login.', 'error'); return;}
      setAccounts(next);
      push('chatgpt-account-picker');
    } catch (error) {setNotice(error instanceof Error ? error.message : 'Could not load ChatGPT accounts.', 'error');}
    finally {setIsLoadingAccounts(false);}
  }

  return {run, openAccountPicker, accounts, isRunning, isLoadingAccounts,
    cancel: () => authAbort?.abort(), selectAccount: (id: string) => {void run('use', id);}};
}
