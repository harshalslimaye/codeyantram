import { describe, test, expect } from 'bun:test';
import { parseResumeTarget } from '../src/resume';

describe('parseResumeTarget', () => {
    test('no flags means no resume target', () => {
        expect(parseResumeTarget([])).toBeNull();
        expect(parseResumeTarget(['some', 'other', 'arg'])).toBeNull();
    });

    test('--continue resumes the most recent session', () => {
        expect(parseResumeTarget(['--continue'])).toEqual({ mode: 'continue' });
    });

    test('--resume <id> resumes that specific session', () => {
        expect(parseResumeTarget(['--resume', 'abc123'])).toEqual({ mode: 'resume', id: 'abc123' });
    });

    test('--resume with no following value is ignored', () => {
        expect(parseResumeTarget(['--resume'])).toBeNull();
    });

    test('--resume immediately followed by another flag is treated as missing its value', () => {
        expect(parseResumeTarget(['--resume', '--continue'])).toEqual({ mode: 'continue' });
        expect(parseResumeTarget(['--resume', '--verbose'])).toBeNull();
    });

    test('--continue wins if both are somehow given', () => {
        expect(parseResumeTarget(['--resume', 'abc123', '--continue'])).toEqual({ mode: 'continue' });
    });

    test('flags can appear alongside other, unrelated argv entries', () => {
        expect(parseResumeTarget(['--verbose', '--resume', 'xyz', '--other'])).toEqual({ mode: 'resume', id: 'xyz' });
    });
});
