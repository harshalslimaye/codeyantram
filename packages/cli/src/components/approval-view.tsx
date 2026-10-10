import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';
import type {ApprovalController, ApprovalItem} from '../chat/approval.js';
import {useKeyboardOwner} from '../keyboard/provider.js';
import {useTheme} from '../theme/provider.js';

const VIEW_CHROME_ROWS = 12;
const VIEW_SIDE_COLUMNS = 6;
const PAGE_OVERLAP = 1;

function wrapLines(text: string, width: number): string[] {
  return text.split('\n').flatMap(line => {
    if (line.length === 0) return [''];
    const chunks: string[] = [];
    for (let index = 0; index < line.length; index += width) chunks.push(line.slice(index, index + width));
    return chunks;
  });
}

export function approvalText(item: ApprovalItem): string {
  if (item.kind === 'command') return [
    `Command approval · ${item.request.workdir} · timeout ${item.request.timeoutMs} ms`,
    `Objective: ${item.request.objective ?? '(none)'}`,
    'Exact command:', item.request.command,
  ].join('\n');
  return [
    `Patch approval · ${item.request.changes.length} file(s)`,
    `Objective: ${item.request.objective ?? '(none)'}`,
    ...item.request.changes.map(change => `${change.action} ${change.filePath}\n  before: ${change.beforeHash ?? '(none)'}\n  after: ${change.afterHash ?? '(none)'}`),
    'Exact patch:', item.request.patchText,
  ].join('\n');
}

export function ApprovalView({controller, item, onCancel}: {
  controller: ApprovalController; item: ApprovalItem; onCancel: () => void;
}) {
  const {columns, rows} = useWindowSize();
  const {palette} = useTheme();
  const {push, pop, isOwner} = useKeyboardOwner();
  const [offset, setOffset] = useState(0);
  const pageSize = Math.max(1, rows - VIEW_CHROME_ROWS);
  const lines = useMemo(() => wrapLines(approvalText(item), Math.max(1, columns - VIEW_SIDE_COLUMNS)), [item, columns]);
  const maxOffset = Math.max(0, lines.length - pageSize);
  const visibleOffset = Math.min(offset, maxOffset);
  useEffect(() => {
    push('approval');
    return () => pop('approval');
  }, [push, pop]);
  useInput((input, key) => {
    if (!isOwner('approval')) return;
    if (key.escape) {controller.decide(item.id, false); onCancel(); return;}
    if (input.toLowerCase() === 'a') {controller.decide(item.id, true); return;}
    if (input.toLowerCase() === 'd') {controller.decide(item.id, false); return;}
    if (key.upArrow) setOffset(value => Math.max(0, value - 1));
    if (key.downArrow) setOffset(value => Math.min(maxOffset, value + 1));
    if (key.pageUp) setOffset(value => Math.max(0, value - pageSize + PAGE_OVERLAP));
    if (key.pageDown) setOffset(value => Math.min(maxOffset, value + pageSize - PAGE_OVERLAP));
  }, {isActive: true});
  return <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={palette.border} paddingX={1}>
    <Text bold color={palette.primary}>Review {item.kind === 'patch' ? 'patch' : 'command'} before execution</Text>
    <Text color={palette.muted}>↑/↓ or Page Up/Down scroll · A approve · D deny · Esc cancel turn</Text>
    <Text color={palette.muted}>Lines {visibleOffset + 1}–{Math.min(lines.length, visibleOffset + pageSize)} of {lines.length}</Text>
    {lines.slice(visibleOffset, visibleOffset + pageSize).map((line, index) =>
      <Text key={`${visibleOffset + index}`} color={palette.text} wrap="truncate-end">{line || ' '}</Text>)}
  </Box>;
}
