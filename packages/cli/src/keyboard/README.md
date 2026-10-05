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

Draft edits open the command list when the draft starts with `/` and contains no
spaces. Editing out of that pattern closes the command list. Rendering does not
infer ownership from draft text.

Escape closes the command list or theme picker without changing the draft.
Escape in the input bar clears the draft. A dismissed interaction stays closed
until another draft edit triggers it. Visibility and the editing cursor follow
ownership.

Draft text and cursor position remain in `InputBar`. `ThemePicker` owns saving,
retry state, the saving spinner, and closing itself. `Select` owns the
highlighted option and scrolls through up to five visible themes, with the active
theme listed first. Theme selection keeps ownership while saving and ignores
additional input until the save settles. Success returns
ownership to the input bar; failure remounts `Select` so the same theme can be
selected again. Ink retains its default Ctrl+C exit behavior.

Selecting a command closes the command palette before notifying its caller.
`InputBar` clears the draft and executes the command. Selecting `/theme` opens
the theme picker without leaving the palette on the stack. `/help` lists commands,
`/status` appends an estimated context snapshot to scrollback without a model call,
`/compact` summarizes older conversation context, `/clear` resets the conversation,
and `/exit` closes the CLI. Reopening the command
palette mounts a fresh selection starting at `/help`.

Enter in the input bar submits a nonempty message to the chat server. The submit
handler checks both rendered and current ownership so Enter used by the command
palette cannot also submit its draft as chat text. During generation or compaction
the text input and pickers are disabled, while the input bar's Escape listener
cancels the active operation. If an operation starts programmatically while a
picker is open, that interaction closes and keyboard ownership returns to the
input bar. Generation and compaction have distinct progress labels.
Partial assistant text remains in history after cancellation. The chat viewport
handles mouse wheel/trackpad reports while the input and status bars stay pinned
to the bottom, including during streaming and terminal resizing. Scroll over chat
to move three lines per wheel event. Scrolling over the footer or with a picker
open does not move history; PgUp/PgDn have no history handlers. Reading older lines
keeps that position as streamed text grows; scrolling down to the end resumes
following new output. A new turn or `/clear` returns to the bottom.

`terminal/input.ts` separates SGR mouse packets from keyboard/paste input before
Ink sees them, so clicks and wheel reports cannot become prompt text. It forwards
ordinary keys and bracketed paste, handles split UTF-8/escape sequences, and
restores mouse reporting and raw mode during cleanup. The CLI uses Ink's alternate
screen to give mouse coordinates a stable origin and restores the original
terminal screen on exit. History is kept in the session, rather than native
terminal scrollback. `/clear` resets both active context and displayed history.
Exiting unmounts the UI,
aborts the active request, and closes the CLI's server.

`/compact` runs with the active model and keeps the latest two user-led turns
verbatim while retaining the full scrollable transcript. The command itself
does not become a chat message. Success, no-op, failure, and cancellation use the
session notice/error channel. After success, the status bar shows
`Context: compacted` and the current number of recent turns sent alongside the
summary; this count grows with subsequent messages. `/clear` removes the summary
and its indicator. A short history makes no summarization request.

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

`/connect` also lists TypeSafe (JEV) for evaluation-key setup, independently of
the coding-model catalog. `/jev` toggles the persisted opt-in preference and
reports the saved state. Enabling requires a configured TypeSafe key; disabling
keeps the key. The input bar blocks commands and prompt submission during the
write, then restores input. The command makes no model request.
