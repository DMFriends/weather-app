import { execSync } from 'node:child_process';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

/**
 * Resolve the app version at build time.
 *
 * Preference order:
 *   1. APP_VERSION env var (lets CI override, e.g. from a tag push trigger).
 *   2. Latest reachable git tag from `describe --abbrev=0`. Clean tree → that
 *      tag verbatim (HEAD may be on the tag or on descendant commits). Dirty tree
 *      → bump last segment + `-dev` (e.g. reachable tag `v2.0` + local changes →
 *      `2.1-dev`, including when HEAD is past that tag).
 *   3. package.json `version` as a last-resort fallback (e.g. shallow clones,
 *      tarball builds, or a fresh repo with no tags yet).
 */
function tryGit(args: string[]): { ok: boolean; stdout: string } {
	try {
		const out = execSync(`git ${args.join(' ')}`, {
			stdio: ['ignore', 'pipe', 'ignore']
		})
			.toString()
			.trim();
		return { ok: true, stdout: out };
	} catch {
		return { ok: false, stdout: '' };
	}
}

/**
 * Increment the right-most numeric segment ("2.0" → "2.1", "2.0.3" → "2.0.4").
 * Falls back to the input unchanged if the last segment isn't a number.
 */
function bumpLastSegment(version: string): string {
	const parts = version.split('.');
	const lastIdx = parts.length - 1;
	const lastNum = Number.parseInt(parts[lastIdx] ?? '', 10);
	if (!Number.isFinite(lastNum)) return version;
	parts[lastIdx] = String(lastNum + 1);
	return parts.join('.');
}

function resolveAppVersion(): string {
	if (process.env.APP_VERSION) return process.env.APP_VERSION.replace(/^v/i, '');

	const latest = tryGit(['describe', '--tags', '--abbrev=0']);
	if (!latest.ok || !latest.stdout) return pkg.version;

	const cleanTag = latest.stdout.replace(/^v/i, '');

	// Align stat cache before status so mtime-only noise doesn't false-dirty us.
	tryGit(['update-index', '--refresh']);
	// Same notion of "dirty" as `git status`: tracked edits and untracked files
	// (excluding ignored paths).
	const isClean = tryGit(['status', '--porcelain']).stdout === '';

	if (isClean) return cleanTag;
	return `${bumpLastSegment(cleanTag)}-dev`;
}

const APP_VERSION = resolveAppVersion();

export default defineConfig({
	plugins: [sveltekit()],
	define: {
		__APP_VERSION__: JSON.stringify(APP_VERSION)
	}
});
