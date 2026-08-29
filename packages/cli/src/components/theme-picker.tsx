import { useTheme } from '../providers/theme';
import { useOverlay } from '../providers/overlay';
import { OverlayList } from './overlay-list';
import { themes, type Theme } from '../theme';

export function ThemePicker() {
    const { currentTheme, setTheme } = useTheme();
    const overlay = useOverlay();

    return (
        <OverlayList
            items={themes}
            getKey={t => t.name}
            filter={(t, query) => t.name.toLowerCase().startsWith(query.toLowerCase())}
            isActive={t => t.name === currentTheme.name}
            onSelect={t => {
                setTheme(t);
                overlay.close();
            }}
            renderer={(t: Theme, { isActive }) => (
                <text>{isActive ? '● ' : '  '}{t.name}</text>
            )}
            emptyMessage="No Themes found"
        />
    );
}
