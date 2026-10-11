/* oxlint-disable eslint/complexity, eslint/max-depth, typescript/no-non-null-assertion, security/detect-object-injection, security/detect-unsafe-regex -- Bounded, deliberately restricted frontmatter. */
const MAX_BYTES = 32_768;
const MAX_FRONTMATTER_LINES = 64;
const MAX_INSTRUCTIONS = 16_000;
const FIELDS = new Set(['name', 'description', 'extends', 'tools']);

/** Deliberately small YAML subset: plain scalars and one-line or indented string lists. */
export function parseAgentMarkdown(contents: string, id: string): Record<string, unknown> {
  if (Buffer.byteLength(contents) > MAX_BYTES) throw new Error('Agent file exceeds 32 KiB.');
  const lines = contents.replaceAll('\r\n', '\n').split('\n');
  const metadata: Record<string, unknown> = {};
  let bodyStart = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end < 0 || end > MAX_FRONTMATTER_LINES) throw new Error('Invalid agent frontmatter.');
    for (let index = 1; index < end; index++) {
      const line = lines[index]!;
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const match = /^([a-z]+):(?:\s*(.*))?$/.exec(line);
      if (!match || !FIELDS.has(match[1]!) || Object.hasOwn(metadata, match[1]!)) throw new Error('Invalid, duplicate, or unknown frontmatter field.');
      const key = match[1]!;
      const value = (match[2] ?? '').trim();
      if (key === 'tools') {
        if (value.startsWith('[') && value.endsWith(']')) {
          metadata.tools = value.slice(1, -1).trim() ? value.slice(1, -1).split(',').map(item => plain(item.trim())) : [];
        } else if (!value) {
          const items: string[] = [];
          while (index + 1 < end && /^\s+-\s+/.test(lines[index + 1]!)) items.push(plain(lines[++index]!.replace(/^\s+-\s+/, '').trim()));
          metadata.tools = items;
        } else throw new Error('Malformed tools list.');
      } else metadata[key] = plain(value);
    }
    bodyStart = end + 1;
  }
  const instructions = lines.slice(bodyStart).join('\n').trim();
  if (!instructions || instructions.length > MAX_INSTRUCTIONS) throw new Error('Agent instructions must contain 1–16,000 characters.');
  return {id, ...metadata, instructions};
}

function plain(value: string): string {
  if (!value || /[!&*{}[\]<>`]|^[-?:|>]|\s#/.test(value)) throw new Error('Unsupported frontmatter value.');
  return value.replace(/^(['"])(.*)\1$/, '$2');
}
