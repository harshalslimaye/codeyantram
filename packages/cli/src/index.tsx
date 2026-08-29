import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Root } from "./layouts/root";
import { Home } from "./screens/home";

function App() {
  return (
    <Root>
      <Home />
    </Root>
  );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
