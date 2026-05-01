/**
 * Sets package.json (and the root entry in package-lock.json) to the highest
 * version found on GitHub's public releases Atom feed — same source as
 * src/lib/updateCheck.ts, no API token, no rate limit.
 *
 * Skip with SKIP_SYNC_PACKAGE_VERSION=1 (e.g. offline npm install).
 * Override repo with GITHUB_OWNER / GITHUB_REPO (defaults DMFriends/weather-app).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const OWNER = process.env.GITHUB_OWNER ?? "DMFriends";
const REPO = process.env.GITHUB_REPO ?? "weather-app";
const FEED = `https://github.com/${OWNER}/${REPO}/releases.atom`;

function normalizeVersion(raw) {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim().replace(/^v/i, "");
	const core = trimmed.split(/[-+]/, 1)[0];
	const parts = core.split(".").map((p) => Number.parseInt(p, 10));
	if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
	return parts;
}

/** True iff tag `a` is strictly newer than tag `b` (semver-ish). */
function isNewerTag(a, b) {
	const va = normalizeVersion(a);
	const vb = normalizeVersion(b);
	if (!va || !vb) return false;
	const len = Math.max(va.length, vb.length);
	for (let i = 0; i < len; i++) {
		const av = va[i] ?? 0;
		const bv = vb[i] ?? 0;
		if (av > bv) return true;
		if (av < bv) return false;
	}
	return false;
}

function parseAtomTitles(xml) {
	const out = [];
	const entryRegex = /<entry\b[\s\S]*?<\/entry>/g;
	const titleRegex = /<title[^>]*>([\s\S]*?)<\/title>/;
	for (const entry of xml.match(entryRegex) ?? []) {
		const title = titleRegex.exec(entry)?.[1]?.trim();
		if (title) out.push(title);
	}
	return out;
}

function pickHighestTag(titles) {
	let best = null;
	for (const t of titles) {
		if (!normalizeVersion(t)) continue;
		if (!best || isNewerTag(t, best)) best = t;
	}
	return best;
}

function writeJson(filePath, data) {
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, "\t")}\n`, "utf8");
}

async function main() {
	if (process.env.SKIP_SYNC_PACKAGE_VERSION === "1") {
		return;
	}

	let xml;
	try {
		const res = await fetch(FEED, { cache: "no-store" });
		if (!res.ok) {
			console.warn(
				`[sync-package-version] GitHub feed HTTP ${res.status}, keeping package.json version`,
			);
			return;
		}
		xml = await res.text();
	} catch (e) {
		console.warn("[sync-package-version] fetch failed, keeping package.json version:", e.message);
		return;
	}

	const tag = pickHighestTag(parseAtomTitles(xml));
	if (!tag) {
		console.warn("[sync-package-version] no release tags in feed, keeping package.json version");
		return;
	}

	const version = tag.replace(/^v/i, "");
	const pkgPath = path.join(ROOT, "package.json");
	const lockPath = path.join(ROOT, "package-lock.json");

	const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
	if (pkg.version === version) {
		return;
	}

	pkg.version = version;
	writeJson(pkgPath, pkg);

	if (fs.existsSync(lockPath)) {
		const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
		lock.version = version;
		if (lock.packages?.[""]) {
			lock.packages[""].version = version;
		}
		writeJson(lockPath, lock);
	}

	console.log(`[sync-package-version] set package version to ${version} (from GitHub releases)`);
}

await main();
