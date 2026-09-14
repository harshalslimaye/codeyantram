import { describe, test, expect } from 'bun:test';
import { formatRelativeTime, formatTokenCount } from '../../src/utils/format';

describe('formatTokenCount', () => {
    test('leaves small counts as plain numbers', () => {
        expect(formatTokenCount(42)).toBe('42');
    });

    test('formats thousands with one decimal', () => {
        expect(formatTokenCount(1234)).toBe('1.2k');
    });

    test('formats millions with one decimal', () => {
        expect(formatTokenCount(1_050_000)).toBe('1.1M');
    });
});

describe('formatRelativeTime', () => {
    const now = Date.now();

    test('a moment ago reads as "just now"', () => {
        expect(formatRelativeTime(now - 10_000)).toBe('just now');
    });

    test('minutes ago', () => {
        expect(formatRelativeTime(now - 5 * 60_000)).toBe('5m ago');
    });

    test('hours ago', () => {
        expect(formatRelativeTime(now - 3 * 60 * 60_000)).toBe('3h ago');
    });

    test('days ago', () => {
        expect(formatRelativeTime(now - 2 * 24 * 60 * 60_000)).toBe('2d ago');
    });

    test('falls back to a plain date once a week has passed', () => {
        const timestamp = now - 10 * 24 * 60 * 60_000;
        expect(formatRelativeTime(timestamp)).toBe(new Date(timestamp).toLocaleDateString());
    });
});
