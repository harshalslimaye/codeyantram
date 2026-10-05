import {execFileSync} from 'node:child_process';
import {describe, expect, it, vi} from 'vitest';
import {getGitBranch} from '../../src/lib/utils.js';
import {getCommandOptions} from '../../src/lib/commands.js';

vi.mock('node:child_process', () => ({execFileSync: vi.fn()}));

describe('git branch display', () => {
	it('reads and trims the branch for the requested workspace', () => {
		vi.mocked(execFileSync).mockReturnValueOnce('  feature/test\n');
		expect(getGitBranch('/workspace')).toBe('feature/test');
		expect(execFileSync).toHaveBeenCalledWith('git', ['branch', '--show-current'], {cwd: '/workspace', encoding: 'utf8'});
	});
	it('shows detached when HEAD has no branch', () => {
		vi.mocked(execFileSync).mockReturnValueOnce('\n');
		expect(getGitBranch('/workspace')).toBe('detached');
	});
	it('shows unknown when git cannot read the workspace', () => {
		vi.mocked(execFileSync).mockImplementationOnce(() => {throw new Error('not a repository');});
		expect(getGitBranch('/workspace')).toBe('unknown');
	});
});

describe('command filtering', () => {
	it('shows all commands for an empty query and matches case-insensitive prefixes', () => {
		expect(getCommandOptions()).toHaveLength(10);
		expect(getCommandOptions('INI')).toEqual([{value: '/init', label: expect.stringContaining('Build or refresh the project code graph')}]);
		expect(getCommandOptions('MoD')).toEqual([{value: '/model', label: expect.stringContaining('/model')}]);
		expect(getCommandOptions('JeV')).toEqual([{value: '/jev', label: expect.stringContaining('Toggle JEV usage on or off')}]);
		expect(getCommandOptions('unknown')).toEqual([]);
	});
});
