import { Element, Text, type AnyNode } from 'domhandler';
import { parseDocument } from 'htmlparser2';
import type { FetchCategory } from './web-fetch';

export type ExtractedContent = {
    title: string | null;
    text: string;
};

// Removed outright, from both block and inline context - never rendered, never
// recursed into. head is here (not just its script/style descendants) because its
// only useful children (title, meta, link, base) are pulled out by extractMetadata
// before the content walk ever starts.
const DROPPED_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'iframe', 'template', 'form', 'head']);

// Excluded only when there's no <main>/<article> to trust and we fall back to
// rendering <body> directly - see selectContentRoot. A real <main> that happens to
// contain a <nav> (unusual, but not invalid) is rendered as-is: finding *a* main
// content container is itself the signal that the rest of the page is chrome.
const NAV_LIKE_TAGS = new Set(['nav', 'header', 'footer', 'aside']);

// Tags whose rendered content flows inline with surrounding text, rather than
// starting a new paragraph. Everything not listed here (div, section, article, li's
// own container, span-that-turns-out-to-be-unknown, etc.) is treated as block-level
// by the fallback case in renderBlock.
const INLINE_TAGS = new Set(['a', 'strong', 'b', 'em', 'i', 'span', 'small', 'sub', 'sup', 'mark', 'u', 's', 'del', 'ins', 'abbr', 'code', 'br']);

type Ctx = {
    baseUrl: string;
    excludeNavLike: boolean;
};

function isElement(node: AnyNode): node is Element {
    return node instanceof Element;
}

function isText(node: AnyNode): node is Text {
    return node instanceof Text;
}

function isDropped(tag: string): boolean {
    return DROPPED_TAGS.has(tag);
}

function isExcludedNavLike(el: Element, ctx: Ctx): boolean {
    return ctx.excludeNavLike && (NAV_LIKE_TAGS.has(el.name) || el.attribs['role'] === 'navigation');
}

/** Depth-first search for the first element matching `predicate`. */
function findFirst(nodes: AnyNode[], predicate: (el: Element) => boolean): Element | null {
    for (const node of nodes) {
        if (!isElement(node)) continue;
        if (predicate(node)) return node;

        const found = findFirst(node.children, predicate);
        if (found !== null) return found;
    }
    return null;
}

/** Raw text content of a subtree, ignoring markup entirely - used for <pre>/<code>
 * bodies and table-cell text, where inline markdown formatting would either corrupt
 * the content (code) or isn't worth the complexity (a cell's plain text is plenty). */
function textContent(nodes: AnyNode[]): string {
    let out = '';
    for (const node of nodes) {
        if (isText(node)) out += node.data;
        else if (isElement(node)) {
            if (node.name === 'br') out += '\n';
            out += textContent(node.children);
        }
    }
    return out;
}

function resolveHref(href: string, ctx: Ctx): string | null {
    const trimmed = href.trim();
    if (trimmed === '' || trimmed.toLowerCase().startsWith('javascript:')) return null;

    try {
        return new URL(trimmed, ctx.baseUrl).href;
    } catch {
        return null;
    }
}

function renderInline(nodes: AnyNode[], ctx: Ctx): string {
    let out = '';

    for (const node of nodes) {
        if (isText(node)) {
            out += node.data;
            continue;
        }
        if (!isElement(node) || isDropped(node.name)) continue;

        switch (node.name) {
            case 'br':
                out += '\n';
                break;
            case 'a': {
                const inner = renderInline(node.children, ctx).trim();
                const href = node.attribs['href'];
                const resolved = href !== undefined ? resolveHref(href, ctx) : null;
                out += resolved !== null ? `[${inner || resolved}](${resolved})` : inner;
                break;
            }
            case 'strong':
            case 'b': {
                const inner = renderInline(node.children, ctx).trim();
                out += inner === '' ? '' : `**${inner}**`;
                break;
            }
            case 'em':
            case 'i': {
                const inner = renderInline(node.children, ctx).trim();
                out += inner === '' ? '' : `*${inner}*`;
                break;
            }
            case 'code': {
                const inner = textContent(node.children).trim();
                out += inner === '' ? '' : `\`${inner}\``;
                break;
            }
            default:
                // Any other inline-flowing tag (span, small, mark, ...) is unwrapped -
                // its text matters, its markup doesn't.
                out += renderInline(node.children, ctx);
        }
    }

    return out;
}

function renderList(el: Element, ordered: boolean, depth: number, ctx: Ctx): string {
    let out = '';
    let index = 1;

    for (const child of el.children) {
        if (!isElement(child) || child.name !== 'li') continue;

        const indent = '  '.repeat(depth);
        const marker = ordered ? `${index}.` : '-';

        const nestedLists = child.children.filter((n): n is Element => isElement(n) && (n.name === 'ul' || n.name === 'ol'));
        const inlineChildren = child.children.filter(n => !(isElement(n) && (n.name === 'ul' || n.name === 'ol')));

        const text = renderInline(inlineChildren, ctx).trim().replace(/\s*\n\s*/g, ' ');
        out += `${indent}${marker} ${text}\n`;

        for (const nested of nestedLists) {
            out += renderList(nested, nested.name === 'ol', depth + 1, ctx);
        }

        index++;
    }

    return out;
}

const MAX_TABLE_COLUMNS = 20;
const MAX_TABLE_ROWS = 100;

function collectRows(el: Element): Element[] {
    const rows: Element[] = [];
    const walk = (node: AnyNode): void => {
        if (!isElement(node)) return;
        if (node.name === 'tr') rows.push(node);
        else for (const child of node.children) walk(child);
    };
    for (const child of el.children) walk(child);
    return rows;
}

function cellText(cell: Element, ctx: Ctx): string {
    return renderInline(cell.children, ctx)
        .trim()
        .replace(/\s*\n\s*/g, ' ')
        .replace(/\|/g, '\\|');
}

function renderTable(el: Element, ctx: Ctx): string {
    const allRows = collectRows(el);
    if (allRows.length === 0) return '';

    const truncatedRows = allRows.length > MAX_TABLE_ROWS;
    const rows = allRows.slice(0, MAX_TABLE_ROWS).map(row => row.children.filter((n): n is Element => isElement(n) && (n.name === 'td' || n.name === 'th')));

    const columnCount = Math.min(Math.max(...rows.map(row => row.length), 1), MAX_TABLE_COLUMNS);
    const truncatedColumns = rows.some(row => row.length > MAX_TABLE_COLUMNS);

    const toLine = (cells: Element[]): string => {
        const values = Array.from({ length: columnCount }, (_, i) => (i < cells.length ? cellText(cells[i]!, ctx) : ''));
        return `| ${values.join(' | ')} |`;
    };

    const [header, ...body] = rows;
    if (header === undefined) return '';

    const lines = [toLine(header), `| ${Array(columnCount).fill('---').join(' | ')} |`, ...body.map(toLine)];

    const notes = [
        truncatedColumns ? `columns beyond ${MAX_TABLE_COLUMNS} truncated` : null,
        truncatedRows ? `rows beyond ${MAX_TABLE_ROWS} truncated (${allRows.length} total)` : null,
    ].filter((note): note is string => note !== null);

    const noteLine = notes.length > 0 ? `\n_(${notes.join('; ')})_` : '';
    return `${lines.join('\n')}${noteLine}\n\n`;
}

function renderBlock(nodes: AnyNode[], ctx: Ctx): string {
    let out = '';

    for (const node of nodes) {
        if (isText(node)) {
            const trimmed = node.data.trim();
            if (trimmed !== '') out += `${trimmed}\n\n`;
            continue;
        }
        if (!isElement(node) || isDropped(node.name) || isExcludedNavLike(node, ctx)) continue;

        if (INLINE_TAGS.has(node.name)) {
            const inline = renderInline([node], ctx).trim();
            if (inline !== '') out += `${inline}\n\n`;
            continue;
        }

        switch (node.name) {
            case 'h1':
            case 'h2':
            case 'h3':
            case 'h4':
            case 'h5':
            case 'h6': {
                const level = Number(node.name[1]);
                const text = renderInline(node.children, ctx).trim().replace(/\s*\n\s*/g, ' ');
                if (text !== '') out += `${'#'.repeat(level)} ${text}\n\n`;
                break;
            }

            case 'p': {
                const text = renderInline(node.children, ctx).trim();
                if (text !== '') out += `${text}\n\n`;
                break;
            }

            case 'pre': {
                const codeChild = node.children.find((n): n is Element => isElement(n) && n.name === 'code');
                const langMatch = /(?:language|lang)-(\S+)/.exec(codeChild?.attribs['class'] ?? '');
                const lang = langMatch?.[1] ?? '';
                const code = textContent(codeChild !== undefined ? [codeChild] : node.children).replace(/\n+$/, '');
                out += `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
                break;
            }

            case 'blockquote': {
                const inner = renderBlock(node.children, ctx).trim();
                if (inner !== '') {
                    out += `${inner
                        .split('\n')
                        .map(line => `> ${line}`.trimEnd())
                        .join('\n')}\n\n`;
                }
                break;
            }

            case 'ul':
            case 'ol': {
                const list = renderList(node, node.name === 'ol', 0, ctx);
                if (list !== '') out += `${list}\n`;
                break;
            }

            case 'table':
                out += renderTable(node, ctx);
                break;

            case 'hr':
                out += '---\n\n';
                break;

            default:
                // A generic container (div, section, article, main, body, header/
                // footer/aside when not excluded, or anything unrecognized) - its own
                // tag carries no markup, but its content is still a block, so its
                // children get the same paragraph-separating treatment.
                out += renderBlock(node.children, ctx);
        }
    }

    return out;
}

/** Collapses the runs of whitespace renderBlock's paragraph-per-tag approach tends to
 * leave behind (an empty <div> becomes ''  which is harmless, but three or four nested
 * empty containers can still stack up blank lines) without touching content inside a
 * fenced code block, which owns its own whitespace. */
function normalize(markdown: string): string {
    const blocks = markdown.split(/(```[\s\S]*?```)/);

    return blocks
        .map((block, i) => {
            if (i % 2 === 1) return block; // a fenced code block - leave verbatim
            return block.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
        })
        .join('')
        .trim();
}

function textOf(el: Element | null): string | null {
    if (el === null) return null;
    const text = textContent(el.children).trim();
    return text === '' ? null : text;
}

function findMeta(document: AnyNode[], match: (attribs: Record<string, string>) => boolean): string | null {
    const el = findFirst(document, node => node.name === 'meta' && match(node.attribs));
    const content = el?.attribs['content']?.trim();
    return content === undefined || content === '' ? null : content;
}

type Metadata = {
    title: string | null;
    canonicalUrl: string | null;
    baseHref: string | null;
};

function extractMetadata(document: AnyNode[], pageUrl: string): Metadata {
    const titleTag = textOf(findFirst(document, el => el.name === 'title'));
    const ogTitle = findMeta(document, attribs => attribs['property'] === 'og:title' || attribs['name'] === 'og:title');

    const canonicalEl = findFirst(document, el => el.name === 'link' && el.attribs['rel']?.toLowerCase() === 'canonical');
    const canonicalHref = canonicalEl?.attribs['href'];
    const canonicalUrl = canonicalHref !== undefined ? resolveHref(canonicalHref, { baseUrl: pageUrl, excludeNavLike: false }) : null;

    const baseEl = findFirst(document, el => el.name === 'base' && el.attribs['href'] !== undefined);
    const baseHrefAttr = baseEl?.attribs['href'];
    const baseHref = baseHrefAttr !== undefined ? resolveHref(baseHrefAttr, { baseUrl: pageUrl, excludeNavLike: false }) : null;

    return { title: titleTag ?? ogTitle, canonicalUrl, baseHref };
}

function selectContentRoot(document: AnyNode[]): { nodes: AnyNode[]; excludeNavLike: boolean } {
    const main = findFirst(document, el => el.name === 'main');
    if (main !== null) return { nodes: main.children, excludeNavLike: false };

    const article = findFirst(document, el => el.name === 'article');
    if (article !== null) return { nodes: article.children, excludeNavLike: false };

    const body = findFirst(document, el => el.name === 'body');
    if (body !== null) return { nodes: body.children, excludeNavLike: true };

    // Not a full document - a fragment response, most likely from an API. Render
    // everything that was parsed, with the same nav-like exclusion as a body fallback.
    return { nodes: document, excludeNavLike: true };
}

// A page whose HTML is substantial but whose extracted text is nearly empty is very
// likely one that renders its real content with client-side JavaScript - something
// this tool never executes. 20 KB / 200 chars are chosen to catch that case without
// flagging a normal short page (a redirect landing page, a minimal doc).
const JS_RENDERED_HTML_THRESHOLD = 20_000;
const JS_RENDERED_TEXT_THRESHOLD = 200;
const JS_RENDERED_NOTE =
    '_This page appears to render its content with JavaScript, which web_fetch does not execute - the text above may be missing most of the page._';

export function htmlToMarkdown(html: string, pageUrl: string): ExtractedContent {
    const document = parseDocument(html).children;
    const metadata = extractMetadata(document, pageUrl);

    const { nodes, excludeNavLike } = selectContentRoot(document);
    const ctx: Ctx = { baseUrl: metadata.baseHref ?? pageUrl, excludeNavLike };

    let markdown = normalize(renderBlock(nodes, ctx));

    if (html.length > JS_RENDERED_HTML_THRESHOLD && markdown.length < JS_RENDERED_TEXT_THRESHOLD) {
        markdown = markdown === '' ? JS_RENDERED_NOTE : `${markdown}\n\n${JS_RENDERED_NOTE}`;
    }

    return { title: metadata.title, text: markdown };
}

const MAX_PRETTY_JSON_BYTES = 100 * 1024;

/** Dispatches on the category performFetch already determined - HTML gets the full
 * extraction above, JSON gets pretty-printed when it's both parseable and small enough
 * for that to be worth it, everything else (text, markdown, xml) passes through as-is,
 * matching what the model asked to fetch rather than reformatting it. */
export function extractContent(category: FetchCategory, text: string, pageUrl: string): ExtractedContent {
    if (category === 'html') return htmlToMarkdown(text, pageUrl);

    if (category === 'json' && Buffer.byteLength(text, 'utf-8') <= MAX_PRETTY_JSON_BYTES) {
        try {
            return { title: null, text: JSON.stringify(JSON.parse(text), null, 2) };
        } catch {
            return { title: null, text };
        }
    }

    return { title: null, text };
}
