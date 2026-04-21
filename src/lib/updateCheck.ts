import { version as packageVersion } from "../../package.json";

/**
 * Semantic version of the currently running app. Sourced from package.json so a
 * single bump there (ideally alongside `git tag vX.Y.Z` and a GitHub release)
 * keeps the in-app update check honest.
 */
export const APP_VERSION = packageVersion;

const GITHUB_OWNER = "DMFriends";
const GITHUB_REPO = "weather-app";
const LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const LATEST_RELEASE_HTML = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

const DISMISSED_VERSION_KEY = "weather-app:updateCheck:dismissedVersion";
const LAST_CHECK_AT_KEY = "weather-app:updateCheck:lastCheckAt";
/** Don't hammer the GitHub API on every app resume — once every 6h is plenty. */
const CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000;

export type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseUrl: string;
  releaseNotes: string;
};

type GithubReleaseResponse = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
};

/** Strip a leading "v" and any build/pre-release suffix so we can numerically compare. */
function normalizeVersion(raw: string): number[] | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^v/i, "");
  const core = trimmed.split(/[-+]/, 1)[0];
  const parts = core.split(".").map((p) => Number.parseInt(p, 10));
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return parts;
}

/** Returns true iff `latest` is strictly greater than `current` (semver-ish). */
export function isNewerVersion(current: string, latest: string): boolean {
  const a = normalizeVersion(current);
  const b = normalizeVersion(latest);
  if (!a || !b) return false;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (bv > av) return true;
    if (bv < av) return false;
  }
  return false;
}

function getDismissedVersion(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(DISMISSED_VERSION_KEY);
  } catch {
    return null;
  }
}

export function dismissUpdate(version: string) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DISMISSED_VERSION_KEY, version);
  } catch {
    /* storage may be unavailable (private mode, etc.) — ignore. */
  }
}

function shouldSkipCheck(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const raw = localStorage.getItem(LAST_CHECK_AT_KEY);
    if (!raw) return false;
    const last = Number.parseInt(raw, 10);
    if (!Number.isFinite(last)) return false;
    return Date.now() - last < CHECK_THROTTLE_MS;
  } catch {
    return false;
  }
}

function markChecked() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LAST_CHECK_AT_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/**
 * Fetches the latest GitHub release and returns info about it iff it is
 * strictly newer than the running app version AND the user has not already
 * dismissed that specific version. Returns null otherwise (including on
 * network errors — update prompts are best-effort, never blocking).
 */
export async function checkForUpdate(
  opts: { force?: boolean; signal?: AbortSignal } = {}
): Promise<UpdateInfo | null> {
  if (!opts.force && shouldSkipCheck()) return null;

  let release: GithubReleaseResponse;
  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: opts.signal,
    });
    if (!res.ok) return null;
    release = (await res.json()) as GithubReleaseResponse;
  } catch {
    return null;
  } finally {
    markChecked();
  }

  if (release.draft || release.prerelease) return null;

  const latestTag = typeof release.tag_name === "string" ? release.tag_name : "";
  if (!latestTag) return null;

  if (!isNewerVersion(APP_VERSION, latestTag)) return null;

  const dismissed = getDismissedVersion();
  if (dismissed && !isNewerVersion(dismissed, latestTag)) return null;

  return {
    currentVersion: APP_VERSION,
    latestVersion: latestTag.replace(/^v/i, ""),
    releaseName:
      (typeof release.name === "string" && release.name.trim()) || latestTag,
    releaseUrl:
      (typeof release.html_url === "string" && release.html_url) ||
      LATEST_RELEASE_HTML,
    releaseNotes: typeof release.body === "string" ? release.body : "",
  };
}
