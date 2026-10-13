import {useState} from 'react';
import {chatExportPath} from '../chat/export.js';
import {useKeyboardOwner} from '../keyboard/provider.js';
import {useTheme} from '../theme/provider.js';
import {Picker} from './picker.js';

export function useExportConfirmation(onExport?: (filePath?: string) => void) {
	const [target, setTarget] = useState<string>();
	const {owner, push, pop, isOwner} = useKeyboardOwner();
	const {setNotice} = useTheme();

	function requestExport(filePath?: string) {
		if (!onExport) {
			setNotice('Chat export is unavailable.', 'error');
			return;
		}
		try {
			setTarget(chatExportPath(filePath));
			push('export-confirmation');
		} catch (error) {
			setNotice(error instanceof Error ? error.message : 'Could not prepare chat export.', 'error');
		}
	}

	function finish(confirmed: boolean) {
		if (!isOwner('export-confirmation')) return;
		pop('export-confirmation');
		setTarget(undefined);
		if (confirmed && target !== undefined) onExport?.(target);
		else setNotice('Chat export cancelled.');
	}

	const confirmation = owner === 'export-confirmation' && target !== undefined
		? <Picker owner="export-confirmation" title={`Export chat to ${target}?`}
			options={
				[
					{value: 'cancel', label: 'Cancel'},
					{value: 'export', label: 'Export'}
				]
			}
			onSelect={value => finish(value === 'export')} onCancel={() => finish(false)} />
		: null;
	return {requestExport, confirmation};
}
