import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createLayerStack } from "./keyboard";
import { Root } from "./layouts/root";
import { Home } from "./screens/home";
import { Session } from "./screens/session";
import { ResumeOnLaunch } from "./components/resume-on-launch";
import { parseResumeTarget, type ResumeTarget } from "./resume";
import { useChat } from "./providers/chat";

const layers = createLayerStack();

// The screen is a pure function of chat state, not its own tracked state -
// sending the first message moves here automatically, and clearing the
// conversation (e.g. a future /new) moves back, with nothing to keep in sync.
// A --continue/--resume launch resolves onto the same messages state via
// ResumeOnLaunch below, so it moves here the same way, once its (async) load lands.
function AppScreen() {
  const { messages } = useChat();
  return messages.length === 0 ? <Home /> : <Session />;
}

type AppProps = {
  resumeTarget: ResumeTarget | null;
};

function App({ resumeTarget }: AppProps) {
  return (
    <Root layers={layers}>
      {resumeTarget !== null && <ResumeOnLaunch target={resumeTarget} />}
      <AppScreen />
    </Root>
  );
}

// @opentui/core destroys the renderer on any ctrl+c by default
// (`exitOnCtrlC`), independent of and in addition to whatever key handlers
// the app registers. That default would quit unconditionally regardless of
// which layer owns the keyboard, so the app's own layered ctrl+c handling
// (InputBar, Autocomplete) needs to be the only thing deciding what ctrl+c
// does.
const resumeTarget = parseResumeTarget(process.argv.slice(2));

const renderer = await createCliRenderer({ exitOnCtrlC: false });
createRoot(renderer).render(<App resumeTarget={resumeTarget} />);
