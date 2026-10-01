import {render} from 'ink';
import {App} from './app.js';

process.stdout.write('\x1b[2J\x1b[H');

render(<App />);
