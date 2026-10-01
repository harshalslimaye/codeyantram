# CLI themes

The CLI uses semantic color roles so components stay independent from a
particular palette. A custom theme is a JSON object with a lowercase `id`, a
display `name`, and a `colors` object containing every role.

| Role | Used for |
| --- | --- |
| `text` | Main prompt and non-selected theme names |
| `muted` | Secondary text and descriptions |
| `primary` | Commands and emphasized actions |
| `border` | Component borders |
| `prompt` | Prompt marker, cursor, and current selection |
| `status` | Branch and status text |
| `success` | Successful theme selection notice |
| `warning` | Warnings and destructive-action labels |
| `error` | Theme selection or persistence errors |

Color values may be a six-digit hex string, an ANSI color index from `0` to
`255`, or `"none"` to inherit the terminal's default foreground or background.
A role may use a `{ "dark": ..., "light": ... }` pair. Reusable colors can be
declared in `defs` and referenced by name from `colors`.

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "defs": {
    "accentColor": "#6C7CE8",
    "quietColor": "#B58656"
  },
  "colors": {
    "text": "#EDE6D6",
    "muted": "quietColor",
    "primary": "accentColor",
    "border": "#292F68",
    "prompt": "#D9A24B",
    "status": "quietColor",
    "success": "#5C9464",
    "warning": "#C0654A",
    "error": "#BB5648"
  }
}
```

## Built-in themes

The built-ins are `konkan` (default), `kaapi`, `thirai`, `sahyadri`, and
`sanganak`, displayed as Sahyadri, Kaapi, Thirai, Konkan, and Sanganak. Their
colors map into the existing semantic roles: `accent` supplies `primary`,
`focus` supplies `prompt`, `paths` supplies `muted` and `status`, `fill` supplies
`border`, and `del` supplies `warning`. The theme system keeps its existing
roles; the provided `bg` and `panel` values do not add roles. Definitions are in
`src/theme/builtins/`.

Themes come from the built-in set and user files in
`~/.config/codeyantram/themes/*.json` on macOS and Linux, or
`%APPDATA%\codeyantram\themes\*.json` on Windows. A user theme with the same `id`
overrides a built-in theme. Invalid files are skipped with a warning that
includes the path and validation issue.

## Choosing and saving a theme

Type `/theme` in the CLI to open the picker. Use the arrow keys to move, Enter
to apply, and Escape to close.

The selected theme is stored in `~/.config/codeyantram/config.json` on macOS
and Linux, or `%APPDATA%\codeyantram\config.json` on Windows, as
`{ "theme": "theme-id" }` and applies across projects.

If no theme has been saved, the CLI starts with `konkan`. If a saved id is
unavailable, the CLI starts with `konkan` and prints a short warning. Existing
saved IDs such as `mitti` or `system` use this fallback.
Unknown fields and missing roles make a custom theme invalid.

## Terminal colors

The CLI checks stdout's color depth. Hex colors use truecolor when available and
are mapped to the nearest 256-color or 16-color palette at lower depths. Color
styling is disabled when color is unavailable or `NO_COLOR` is set. Dark
variants are active by default; light-mode selection is not configurable yet.
