# Keyboard ownership

`KeyboardProvider` in `provider.tsx` keeps a stack of keyboard owners: `input-bar`,
`command-palette`, `theme-picker`, `model-picker`, `effort-picker`,
`provider-picker`, or `api-key-input`. It wraps the CLI in `App`. The input bar is
the permanent bottom entry; only the top entry receives input. Components use
`useKeyboardOwner()` to access the same ownership state; the hook requires a provider.

- `owner` is the React state used to render the active interaction.
- `isOwner(candidate)` checks the current owner synchronously.
- `push(owner)` opens an interaction above the current owner.
- `pop(expectedOwner)` closes the top interaction only if it matches the expected
  owner, restoring the owner below it. A mismatch or the input bar does nothing.
  This prevents a delayed callback from closing a different interaction.

Successful pushes and pops update ownership immediately and schedule a render. For example,
`input-bar → command-palette → theme-picker` restores the command palette when
the theme picker is popped. Interaction state remains in the components.

`InputBar` enables its Ink `useInput` listener only for the input bar or command
palette and checks ownership synchronously for each event. Theme, model, and
effort and provider pickers share `Picker`, which handles Escape, keyboard ownership, the
themed frame, and a stable selection callback. Each caller supplies its options,
selection and cancellation handlers, and saving state. The picker's ink-ui `Select`
handles Up, Down, and Enter; it is mounted only while the picker owns input and
disabled while saving. `CommandPalette` mounts its content only while it owns
input. Its ink-ui `Select` handles Up/Down navigation and Enter selection; the
input bar still handles draft editing and Escape while the palette is open.
Events never fall through from the theme picker to the draft editor.

Draft edits explicitly open the command list when the draft becomes `/`, or the
theme picker when the trimmed, case-insensitive draft becomes `/theme`.
Editing out of the command list closes its entry before opening
another interaction, so the current `/theme` handoff returns directly to the
input bar on close. Rendering does not infer ownership from draft text.

Escape closes the command list or theme picker without changing the draft.
Escape in the input bar clears the draft. A dismissed interaction stays closed
until another draft edit triggers it. Visibility and the editing cursor follow
ownership.

Draft text and cursor position remain in `InputBar`. `ThemePicker` owns saving,
retry state, the saving spinner, and closing itself. It notifies `InputBar` after
a successful selection so the draft can be cleared. `Select` owns the
highlighted option and scrolls through up to five visible themes, with the active
theme listed first. Theme selection keeps ownership while saving and ignores
additional input until the save settles. Success clears the command and returns
ownership to the input bar; failure remounts `Select` so the same theme can be
selected again. Ink retains its default Ctrl+C exit behavior.

Selecting a command closes the command palette before notifying its caller.
`InputBar` then replaces the draft through the same path as typing the command,
so selecting `/theme` opens the theme picker without leaving the palette on the stack.
Other commands are inserted into the prompt; they do not have execution handlers
yet. Reopening the command palette mounts a fresh selection starting at `/help`.

Selecting `/model` opens `ModelPicker`. Selecting a model with effort support
pushes `effort-picker` above `model-picker`; only that model's supported efforts
are shown. Escape in the effort picker returns to the model list, and Escape in
the model picker returns to the input bar. The active model changes only after
the final selection is saved. Models without effort support save immediately.
Both pickers disable prompt editing and ignore input while saving. Save failures
keep the picker open and allow retrying the same choice. Model and per-model effort
preferences are saved to the global user config.

Selecting `/connect` opens `ProviderPicker`. Selecting a provider opens a masked
`ApiKeyInput` above the provider list. Escape returns to the list without saving;
Escape in the list closes the flow. Enter saves a nonempty API key to
`providers[provider].apiKey` in the global user config, then closes both steps.
The prompt stays disabled throughout the flow. Saving blocks additional input,
and failures keep the key input open for retry. Provider labels show whether a
key is configured; saving does not verify the key against the provider's API.
