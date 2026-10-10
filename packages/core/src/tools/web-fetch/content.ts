import {Parser} from 'htmlparser2';
import TurndownService from 'turndown';
import {tables, strikethrough} from 'turndown-plugin-gfm';
import {classifyContent} from './decoding.js';
import {WebFetchError} from './errors.js';
import {MAX_HTML_DEPTH, MAX_HTML_ELEMENTS} from './limits.js';
import type {TransportDocument, WebFormat} from './types.js';

const removed = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'svg', 'canvas', 'head']);
const blocks = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'blockquote', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'table', 'br', 'hr']);
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function absoluteLink(value: string, base: string): string | undefined {
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function convertContent(document: TransportDocument, requested: WebFormat): {content: string; format: WebFormat} {
  if (classifyContent(document.contentType) !== 'html') {
    return {content: document.text, format: /text\/(?:x-)?markdown/i.test(document.contentType) ? 'markdown' : 'text'};
  }
  if (requested === 'html') return {content: document.text, format: 'html'};
  let elements = 0;
  let skipped = 0;
  let pre = 0;
  const stack: {skip: boolean; name: string}[] = [];
  const html: string[] = [];
  const text: string[] = [];
  const parser = new Parser({
    onopentag(name, attrs) {
      if (++elements > MAX_HTML_ELEMENTS || stack.length >= MAX_HTML_DEPTH) {
        throw new WebFetchError('source_too_large', 'HTML conversion exceeds the element or nesting limit. Request explicit HTML if needed.');
      }
      const skip = removed.has(name) || 'hidden' in attrs || attrs['aria-hidden'] === 'true';
      stack.push({skip, name});
      if (skip) skipped++;
      if (skipped) return;
      if (name === 'pre') pre++;
      if (blocks.has(name)) text.push('\n');
      if (name === 'li') text.push('- ');
      const safe: Record<string, string> = {};
      for (const key of ['href', 'src']) if (attrs[key]) {
        const resolved = absoluteLink(attrs[key], document.finalUrl);
        if (resolved !== undefined && resolved !== '') safe[key] = resolved;
      }
      for (const key of ['alt', 'title', 'class', 'colspan', 'rowspan', 'align', 'start']) if (attrs[key]) safe[key] = attrs[key];
      html.push(`<${name}${Object.entries(safe).map(([key, value]) => ` ${key}="${escape(value)}"`).join('')}>`);
    },
    ontext(value) {
      if (skipped) return;
      html.push(escape(value));
      text.push(pre ? value : value.replace(/\s+/g, ' '));
    },
    onclosetag(name) {
      const entry = stack.pop();
      if (!skipped) {
        if (!voidTags.has(name)) html.push(`</${name}>`);
        if (blocks.has(name)) text.push('\n');
        if (name === 'td' || name === 'th') text.push('\t');
        if (name === 'pre') pre--;
      }
      if (entry?.skip === true) skipped--;
    },
  }, {decodeEntities: true});
  parser.end(document.text);
  if (requested === 'text') return {content: text.join('').replace(/^\n+|\n+$/g, ''), format: 'text'};
  const turndown = new TurndownService({headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', preformattedCode: true});
  turndown.use([tables, strikethrough]);
  // Never keep fallback HTML from a table that the GFM plugin cannot represent.
  turndown.addRule('plainUnsupportedTable', {
    filter: node => node.nodeName === 'TABLE' && !node.querySelector('th'),
    replacement: content => `\n\n${content}\n\n`,
  });
  return {content: turndown.turndown(html.join('')), format: 'markdown'};
}
