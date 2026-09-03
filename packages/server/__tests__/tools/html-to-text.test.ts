import { describe, expect, test } from 'bun:test';
import { extractContent, htmlToMarkdown } from '../../src/tools/html-to-text';

const PAGE_URL = 'https://example.com/docs/guide';

describe('htmlToMarkdown', () => {
    test('extracts the <title>', () => {
        const { title } = htmlToMarkdown('<html><head><title>Hello World</title></head><body><p>hi</p></body></html>', PAGE_URL);
        expect(title).toBe('Hello World');
    });

    test('falls back to og:title when there is no <title>', () => {
        const { title } = htmlToMarkdown('<html><head><meta property="og:title" content="OG Title"></head><body><p>hi</p></body></html>', PAGE_URL);
        expect(title).toBe('OG Title');
    });

    test('renders headings at the right level', () => {
        const { text } = htmlToMarkdown('<body><h1>Title</h1><h3>Subsection</h3></body>', PAGE_URL);
        expect(text).toContain('# Title');
        expect(text).toContain('### Subsection');
    });

    test('renders paragraphs separated by a blank line', () => {
        const { text } = htmlToMarkdown('<body><p>First paragraph.</p><p>Second paragraph.</p></body>', PAGE_URL);
        expect(text).toBe('First paragraph.\n\nSecond paragraph.');
    });

    test('renders nested unordered and ordered lists with indentation', () => {
        const html = `<body><ul>
            <li>Item one
                <ol><li>Nested one</li><li>Nested two</li></ol>
            </li>
            <li>Item two</li>
        </ul></body>`;
        const { text } = htmlToMarkdown(html, PAGE_URL);

        expect(text).toContain('- Item one');
        expect(text).toContain('  1. Nested one');
        expect(text).toContain('  2. Nested two');
        expect(text).toContain('- Item two');
    });

    test('resolves a relative link against the page URL', () => {
        const { text } = htmlToMarkdown('<body><p><a href="/other-page">link text</a></p></body>', PAGE_URL);
        expect(text).toBe('[link text](https://example.com/other-page)');
    });

    test('resolves a relative link against <base href> instead of the page URL', () => {
        const html = '<html><head><base href="https://cdn.example.com/assets/"></head><body><p><a href="thing.html">a thing</a></p></body></html>';
        const { text } = htmlToMarkdown(html, PAGE_URL);
        expect(text).toBe('[a thing](https://cdn.example.com/assets/thing.html)');
    });

    test('drops a javascript: link, keeping the label as plain text', () => {
        const { text } = htmlToMarkdown('<body><p><a href="javascript:alert(1)">click me</a></p></body>', PAGE_URL);
        expect(text).toBe('click me');
        expect(text).not.toContain('javascript:');
    });

    test('preserves whitespace and escapes inside a fenced code block, with a language hint', () => {
        const html = '<body><pre><code class="language-js">if (a &lt; b) {\n  return true;\n}</code></pre></body>';
        const { text } = htmlToMarkdown(html, PAGE_URL);
        expect(text).toBe('```js\nif (a < b) {\n  return true;\n}\n```');
    });

    test('renders inline code without treating its contents as markdown', () => {
        const { text } = htmlToMarkdown('<body><p>Run <code>*not bold*</code> here.</p></body>', PAGE_URL);
        expect(text).toBe('Run `*not bold*` here.');
    });

    test('renders a blockquote with a > prefix on every line', () => {
        const { text } = htmlToMarkdown('<body><blockquote><p>Line one.</p><p>Line two.</p></blockquote></body>', PAGE_URL);
        expect(text).toBe('> Line one.\n>\n> Line two.');
    });

    test('renders a table with a header separator, escaping pipes in cells', () => {
        const html = `<body><table>
            <tr><th>Name</th><th>Note</th></tr>
            <tr><td>a | b</td><td>plain</td></tr>
        </table></body>`;
        const { text } = htmlToMarkdown(html, PAGE_URL);

        expect(text).toContain('| Name | Note |');
        expect(text).toContain('| --- | --- |');
        expect(text).toContain('| a \\| b | plain |');
    });

    test('handles an unclosed <p> without losing the following content', () => {
        const { text } = htmlToMarkdown('<body><p>First<p>Second<p>Third</body>', PAGE_URL);
        expect(text).toContain('First');
        expect(text).toContain('Second');
        expect(text).toContain('Third');
    });

    test('strips script and style content, even when it contains markup-like text', () => {
        const html = '<body><script>document.write("</div><h1>fake</h1>")</script><style>.x { content: "</p>"; }</style><p>real content</p></body>';
        const { text } = htmlToMarkdown(html, PAGE_URL);
        expect(text).toBe('real content');
        expect(text).not.toContain('fake');
        expect(text).not.toContain('document.write');
    });

    test('prefers <main> over the rest of the page, dropping nothing inside it', () => {
        const html = `<body>
            <nav>Site nav</nav>
            <main><nav>In-content nav</nav><p>The actual content.</p></main>
            <footer>Site footer</footer>
        </body>`;
        const { text } = htmlToMarkdown(html, PAGE_URL);

        expect(text).toContain('The actual content.');
        expect(text).toContain('In-content nav');
        expect(text).not.toContain('Site nav');
        expect(text).not.toContain('Site footer');
    });

    test('falls back to <body> minus nav/header/footer/aside when there is no <main> or <article>', () => {
        const html = `<body>
            <header>Masthead</header>
            <nav>Primary nav</nav>
            <div role="navigation">Breadcrumbs</div>
            <div><p>The real content.</p></div>
            <aside>Related links</aside>
            <footer>Copyright</footer>
        </body>`;
        const { text } = htmlToMarkdown(html, PAGE_URL);

        expect(text).toBe('The real content.');
    });

    test('flags a page that looks JavaScript-rendered (large HTML, almost no extracted text)', () => {
        const filler = `<!-- ${'x'.repeat(21_000)} -->`;
        const html = `<body>${filler}<div id="root"></div></body>`;
        const { text } = htmlToMarkdown(html, PAGE_URL);
        expect(text).toContain('render its content with JavaScript');
    });

    test('does not flag a normal short page as JavaScript-rendered', () => {
        const { text } = htmlToMarkdown('<body><p>Short but real page.</p></body>', PAGE_URL);
        expect(text).not.toContain('JavaScript');
    });

    test('renders a fragment with no <html>/<body> wrapper', () => {
        const { text } = htmlToMarkdown('<h2>Fragment</h2><p>Some content.</p>', PAGE_URL);
        expect(text).toBe('## Fragment\n\nSome content.');
    });
});

describe('extractContent', () => {
    test('routes html through htmlToMarkdown', () => {
        const { text, title } = extractContent('html', '<html><head><title>T</title></head><body><p>hi</p></body></html>', PAGE_URL);
        expect(title).toBe('T');
        expect(text).toBe('hi');
    });

    test('pretty-prints valid, small JSON', () => {
        const { text } = extractContent('json', '{"a":1,"b":[2,3]}', PAGE_URL);
        expect(text).toBe(JSON.stringify({ a: 1, b: [2, 3] }, null, 2));
    });

    test('passes through JSON that fails to parse, unchanged', () => {
        const malformed = '{not valid json';
        const { text } = extractContent('json', malformed, PAGE_URL);
        expect(text).toBe(malformed);
    });

    test('passes through JSON over the pretty-print size cap, unchanged', () => {
        const big = JSON.stringify({ data: 'x'.repeat(200 * 1024) });
        const { text } = extractContent('json', big, PAGE_URL);
        expect(text).toBe(big);
    });

    test('passes text, markdown, and xml through untouched', () => {
        expect(extractContent('text', 'plain text', PAGE_URL).text).toBe('plain text');
        expect(extractContent('markdown', '# already markdown', PAGE_URL).text).toBe('# already markdown');
        expect(extractContent('xml', '<a>1</a>', PAGE_URL).text).toBe('<a>1</a>');
    });
});
