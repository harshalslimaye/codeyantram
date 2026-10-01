import { execFileSync } from 'node:child_process';

export function getGitBranch(root: string): string {
	try {
		return execFileSync('git', ['branch', '--show-current'], {
			cwd: root,
			encoding: 'utf8',
		}).trim() || 'detached';
	} catch {
		return 'unknown';
	}
}

