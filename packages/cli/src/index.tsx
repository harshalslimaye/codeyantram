import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createLayerStack } from "./keyboard";
import { Root } from "./layouts/root";
import { Home } from "./screens/home";

const layers = createLayerStack();

function App() {
  return (
    <Root layers={layers}>
      <Home />
    </Root>
  );
}

// @opentui/core destroys the renderer on any ctrl+c by default
// (`exitOnCtrlC`), independent of and in addition to whatever key handlers
// the app registers. That default would quit unconditionally regardless of
// which layer owns the keyboard, so the app's own layered ctrl+c handling
// (InputBar, Autocomplete) needs to be the only thing deciding what ctrl+c
// does.
const renderer = await createCliRenderer({ exitOnCtrlC: false });
createRoot(renderer).render(<App />);
