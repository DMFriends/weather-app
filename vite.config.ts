import { execSync } from 'node:child_process';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

/**
 * Resolve the app version at build time.
 *
 * Preference order:
 *   1. APP_VERSION env var (lets CI override, e.g. from a tag push trigger).
 *   2. Latest reachable git tag. If the build exactly matches that tag with
 *      a clean working tree, we use it verbatim ("2.1"). Otherwise we
 *      auto-bump to the *next* anticipated release with a "-dev" suffix
 *      ("2.0" + pending changes → "2.1-dev"), since dev builds are
 *      conceptually working toward the next version, not lingering on the
 *      previous one.
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

	// `--exact-match` exits non-zero when HEAD isn't sitting on a tag.
	const isExactTag = tryGit(['describe', '--tags', '--exact-match', 'HEAD']).ok;
	// `diff-index --quiet` exits non-zero when there are uncommitted changes
	// (staged or unstaged). It does NOT consider untracked files, which is
	// what we want — random scratch files shouldn't taint the version.
	const isClean = tryGit(['diff-index', '--quiet', 'HEAD', '--']).ok;

	if (isExactTag && isClean) return cleanTag;
	return `${bumpLastSegment(cleanTag)}-dev`;
}

const APP_VERSION = resolveAppVersion();

export default defineConfig({
	plugins: [sveltekit()],
	define: {
		__APP_VERSION__: JSON.stringify(APP_VERSION)
	}
});
