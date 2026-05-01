import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

/**
 * Semantic version of the currently running app. Injected at build time by
 * Vite (see `vite.config.ts` → `resolveAppVersion`), which prefers the latest
 * `git describe --tags` value so the in-app update banner stays in sync with
 * the GitHub release tag the build was cut from — no manual package.json bump
 * required.
 */
declare const __APP_VERSION__: string;
export const APP_VERSION = __APP_VERSION__;

const GITHUB_OWNER = "DMFriends";
const GITHUB_REPO = "weather-app";
const LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const LATEST_RELEASE_HTML = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

const DISMISSED_VERSION_KEY = "weather-app:updateCheck:dismissedVersion";
const LAST_CHECK_AT_KEY = "weather-app:updateCheck:lastCheckAt";
const ETAG_KEY = "weather-app:updateCheck:etag";
const CACHED_RELEASE_KEY = "weather-app:updateCheck:cachedRelease";
const NOTIFIED_VERSION_KEY = "weather-app:updateCheck:notifiedVersion";
const LAST_MANUAL_CHECK_AT_KEY = "weather-app:updateCheck:lastManualCheckAt";

/** Stable id so the OS coalesces repeat notifications instead of stacking. */
const UPDATE_NOTIFICATION_ID = 84217;

/**
 * How long to disable the manual "Check for updates" button after a click.
 * Matches the warm-cache throttle so a manual recheck and the automatic one
 * effectively share the same cadence.
 */
export const MANUAL_CHECK_COOLDOWN_MS = 30 * 60 * 1000;
/**
 * Throttle for the *first* (uncached) check against the GitHub API — that one
 * costs a rate-limit point, so we keep the cadence conservative.
 */
const COLD_CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000;
/**
 * Throttle once we have an ETag cached. Conditional requests that come back
 * 304 Not Modified do not count against the rate limit, so we can poll much
 * more aggressively and still be polite — 30 min gives a snappy notification
 * after a release without spamming GitHub.
 */
const WARM_CHECK_THROTTLE_MS = 30 * 60 * 1000;

export type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  /** GitHub release HTML page (release notes etc.). */
  releaseUrl: string;
  /**
   * Direct APK download URL, derived from the tag name. Mirrors the asset
   * naming convention used by every release: `weather-app-vX.Y.apk`. We
   * synthesize this from the tag rather than scraping the release `assets`
   * array so it works even if the API response is being served from cache /
   * stripped down via `cache: "no-store"`.
   */
  apkUrl: string;
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

function getNotifiedVersion(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(NOTIFIED_VERSION_KEY);
  } catch {
    return null;
  }
}

function setNotifiedVersion(version: string) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(NOTIFIED_VERSION_KEY, version);
  } catch {
    /* ignore */
  }
}

/**
 * Forces an immediate re-check by clearing throttle + cache state. Handy in
 * the dev console and when wiring a manual "check for updates" UI.
 */
export function clearUpdateCheckState() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LAST_CHECK_AT_KEY);
    localStorage.removeItem(ETAG_KEY);
    localStorage.removeItem(CACHED_RELEASE_KEY);
    localStorage.removeItem(NOTIFIED_VERSION_KEY);
    localStorage.removeItem(LAST_MANUAL_CHECK_AT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Milliseconds remaining on the manual-check cooldown, or 0 if the user is
 * free to click. UI can disable the button while this is > 0 and render a
 * countdown.
 */
export function getManualCheckCooldownRemainingMs(): number {
  if (typeof localStorage === "undefined") return 0;
  try {
    const raw = localStorage.getItem(LAST_MANUAL_CHECK_AT_KEY);
    if (!raw) return 0;
    const last = Number.parseInt(raw, 10);
    if (!Number.isFinite(last)) return 0;
    const remaining = MANUAL_CHECK_COOLDOWN_MS - (Date.now() - last);
    return remaining > 0 ? remaining : 0;
  } catch {
    return 0;
  }
}

function markManualChecked() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LAST_MANUAL_CHECK_AT_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/**
 * User-initiated check from a "Check for updates" button. Forces a real
 * (non-throttled) request to GitHub, records the click time so the UI can
 * cool the button down, and reports back whether an update was found so the
 * caller can render feedback ("up to date" vs the regular update banner).
 */
export async function manualCheckForUpdate(
  signal?: AbortSignal,
): Promise<UpdateInfo | null> {
  markManualChecked();
  return checkForUpdate({ force: true, signal });
}

/**
 * Posts a local OS-level notification about an available update — once per
 * version, so we don't re-buzz the user on every successful update check.
 * Silently no-ops on web (LocalNotifications is a native-only plugin) and
 * when the user denies notification permission.
 */
export async function notifyUpdateAvailable(info: UpdateInfo): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (getNotifiedVersion() === info.latestVersion) return;

  try {
    const checked = await LocalNotifications.checkPermissions();
    if (checked.display !== "granted") {
      const requested = await LocalNotifications.requestPermissions();
      if (requested.display !== "granted") return;
    }

    await LocalNotifications.schedule({
      notifications: [
        {
          id: UPDATE_NOTIFICATION_ID,
          title: "Weather update available",
          body: `v${info.latestVersion} is out — you're on v${info.currentVersion}. Tap to download.`,
          // Stash the APK URL so a tap handler can kick off the download
          // directly. Android's browser/installer takes it from there.
          extra: { url: info.apkUrl, latestVersion: info.latestVersion },
        },
      ],
    });

    setNotifiedVersion(info.latestVersion);
  } catch (e) {
    console.warn("update notification failed", e);
  }
}

function shouldSkipCheck(hasEtag: boolean): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const raw = localStorage.getItem(LAST_CHECK_AT_KEY);
    if (!raw) return false;
    const last = Number.parseInt(raw, 10);
    if (!Number.isFinite(last)) return false;
    const throttle = hasEtag ? WARM_CHECK_THROTTLE_MS : COLD_CHECK_THROTTLE_MS;
    return Date.now() - last < throttle;
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

function readCache(): { etag: string | null; release: GithubReleaseResponse | null } {
  if (typeof localStorage === "undefined") return { etag: null, release: null };
  try {
    const etag = localStorage.getItem(ETAG_KEY);
    const releaseRaw = localStorage.getItem(CACHED_RELEASE_KEY);
    const release = releaseRaw ? (JSON.parse(releaseRaw) as GithubReleaseResponse) : null;
    return { etag, release };
  } catch {
    return { etag: null, release: null };
  }
}

function writeCache(etag: string | null, release: GithubReleaseResponse) {
  if (typeof localStorage === "undefined") return;
  try {
    if (etag) localStorage.setItem(ETAG_KEY, etag);
    else localStorage.removeItem(ETAG_KEY);
    // Only persist the fields we actually consume — keeps the entry small and
    // avoids leaking unrelated GitHub metadata into localStorage.
    const trimmed: GithubReleaseResponse = {
      tag_name: release.tag_name,
      name: release.name,
      html_url: release.html_url,
      body: release.body,
      draft: release.draft,
      prerelease: release.prerelease,
    };
    localStorage.setItem(CACHED_RELEASE_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
}

/**
 * Direct APK download URL derived from a release tag. Every release follows
 * the same asset-naming convention (`weather-app-{tag}.apk`), so we can build
 * the URL deterministically — no need to dig through the `assets` array.
 */
function apkUrlForTag(tag: string): string {
  // Preserve the `v` prefix because that's how the tags + asset filenames are
  // actually named on GitHub (e.g. `v2.0/weather-app-v2.0.apk`).
  const tagSegment = tag.startsWith("v") || tag.startsWith("V") ? tag : `v${tag}`;
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${tagSegment}/weather-app-${tagSegment}.apk`;
}

function buildUpdateInfo(release: GithubReleaseResponse): UpdateInfo | null {
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
    apkUrl: apkUrlForTag(latestTag),
    releaseNotes: typeof release.body === "string" ? release.body : "",
  };
}

/**
 * Fetches the latest GitHub release and returns info about it iff it is
 * strictly newer than the running app version AND the user has not already
 * dismissed that specific version. Returns null otherwise (including on
 * network errors — update prompts are best-effort, never blocking).
 *
 * Uses a stored ETag + `If-None-Match` so steady-state checks come back as
 * 304 Not Modified, which doesn't count against GitHub's rate limit. We still
 * re-evaluate the cached payload on every call so things like a fresh install
 * (older APP_VERSION) or a newly un-dismissed version surface immediately
 * without waiting for a release on GitHub to change.
 */
export async function checkForUpdate(
  opts: { force?: boolean; signal?: AbortSignal } = {}
): Promise<UpdateInfo | null> {
  const { etag: cachedEtag, release: cachedRelease } = readCache();

  if (!opts.force && shouldSkipCheck(Boolean(cachedEtag))) {
    // Still let a previously-cached release surface the banner — useful when
    // the user just upgraded and we already know about a newer release that
    // they shouldn't be on, or they just un-dismissed by clearing storage.
    return cachedRelease ? buildUpdateInfo(cachedRelease) : null;
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (cachedEtag) headers["If-None-Match"] = cachedEtag;

  let release: GithubReleaseResponse | null = cachedRelease;
  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers,
      signal: opts.signal,
      // Bypass the webview HTTP cache so our manual If-None-Match handling is
      // authoritative — otherwise the cache may transparently turn a 304 into
      // a 200 (with the cached body), and we'd never see the real status.
      cache: "no-store",
    });

    if (res.status === 304) {
      // Not modified — nothing to update, fall through using cached release.
    } else if (res.ok) {
      release = (await res.json()) as GithubReleaseResponse;
      writeCache(res.headers.get("ETag"), release);
    } else {
      return null;
    }
  } catch {
    return null;
  } finally {
    markChecked();
  }

  return release ? buildUpdateInfo(release) : null;
}
