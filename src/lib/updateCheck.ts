import { Capacitor, CapacitorHttp } from "@capacitor/core";
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
/**
 * Public Atom feed of all releases. We use this instead of the JSON API
 * because:
 *   - It's served by github.com web servers (not api.github.com), so it has
 *     no rate limit attached to it — we can poll freely.
 *   - It lists every release, latest first, ignoring the "Set as the latest
 *     release" checkbox UI quirk that previously made our update check miss
 *     newer-but-not-marked-latest releases.
 *
 * Trade-off: the feed doesn't expose a prerelease flag, so if a release is
 * marked as prerelease on GitHub, the update check will still surface it.
 * Our normal release flow doesn't use prereleases, so this is fine.
 */
const RELEASES_FEED_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases.atom`;
const LATEST_RELEASE_HTML = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

const LAST_CHECK_AT_KEY = "weather-app:updateCheck:lastCheckAt";
const CACHED_RELEASE_KEY = "weather-app:updateCheck:cachedRelease";
const NOTIFIED_VERSION_KEY = "weather-app:updateCheck:notifiedVersion";
/**
 * Legacy localStorage key for conditional requests (`If-None-Match`). We drop
 * ETags entirely — the Atom feed isn't rate limited and stale 304 semantics
 * were hiding fresh releases briefly after tag/release edits on GitHub.
 */
const LEGACY_ETAG_KEY = "weather-app:updateCheck:etag";

/** Stable id so the OS coalesces repeat notifications instead of stacking. */
const UPDATE_NOTIFICATION_ID = 84217;
/**
 * Minimum spacing between background update checks. No API rate limits on the
 * Atom feed, but we still avoid a network round-trip on every app open. Manual
 * checks use `{ force: true }` and bypass this.
 */
const CHECK_THROTTLE_MS = 30 * 60 * 1000;

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
 * Clears throttle + cached release keys. Useful from the dev console or when
 * testing update flows.
 */
export function clearUpdateCheckState() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LAST_CHECK_AT_KEY);
    localStorage.removeItem(CACHED_RELEASE_KEY);
    localStorage.removeItem(NOTIFIED_VERSION_KEY);
    localStorage.removeItem(LEGACY_ETAG_KEY);
    localStorage.removeItem("weather-app:updateCheck:dismissedVersion");
  } catch {
    /* ignore */
  }
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
          extra: { url: info.apkUrl, latestVersion: info.latestVersion },
        },
      ],
    });

    setNotifiedVersion(info.latestVersion);
  } catch (e) {
    console.warn("update notification failed", e);
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

function readCachedRelease(): GithubReleaseResponse | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHED_RELEASE_KEY);
    return raw ? (JSON.parse(raw) as GithubReleaseResponse) : null;
  } catch {
    return null;
  }
}

function writeCachedRelease(release: GithubReleaseResponse) {
  if (typeof localStorage === "undefined") return;
  try {
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
 * From a list of releases, return the one with the highest version tag,
 * skipping drafts and prereleases. Tie-breaks (same version) prefer the
 * entry that appears earlier in the list (GitHub feed orders by most-recent
 * first, so we keep the most recently created).
 */
function pickHighestRelease(
  releases: GithubReleaseResponse[],
): GithubReleaseResponse | null {
  let best: GithubReleaseResponse | null = null;
  let bestTag: string | null = null;
  for (const r of releases) {
    if (!r || r.draft || r.prerelease) continue;
    const tag = typeof r.tag_name === "string" ? r.tag_name : "";
    if (!tag) continue;
    if (!bestTag || isNewerVersion(bestTag, tag)) {
      best = r;
      bestTag = tag;
    }
  }
  return best;
}

/**
 * Parse the GitHub releases Atom feed into the same minimal release shape
 * the rest of the pipeline already understands. We only look at `<title>`
 * (the tag, e.g. "v2.2") and the alternate `<link href>` (the release HTML
 * page). The feed has no prerelease/draft flags, so those default to false —
 * see the comment on RELEASES_FEED_URL for the trade-off.
 */
function parseAtomFeed(xml: string): GithubReleaseResponse[] {
  const out: GithubReleaseResponse[] = [];
  const entryRegex = /<entry\b[\s\S]*?<\/entry>/g;
  const titleRegex = /<title[^>]*>([\s\S]*?)<\/title>/;
  const linkRegex = /<link\b[^>]*\bhref="([^"]+)"/;
  for (const entry of xml.match(entryRegex) ?? []) {
    const title = titleRegex.exec(entry)?.[1]?.trim();
    const href = linkRegex.exec(entry)?.[1]?.trim();
    if (!title) continue;
    out.push({
      tag_name: title,
      name: title,
      html_url: href,
      body: "",
      draft: false,
      prerelease: false,
    });
  }
  return out;
}

/**
 * Fetch the Atom feed using `CapacitorHttp` on native (CORS-safe). Falls back
 * to `fetch()` on web. Every request loads the full feed body — no ETags,
 * no 304 branch.
 */
async function fetchReleasesFeed(
  signal: AbortSignal | undefined,
): Promise<{ status: number; xml: string } | null> {
  const headers: Record<string, string> = { Accept: "application/atom+xml" };

  if (Capacitor.isNativePlatform()) {
    try {
      const res = await CapacitorHttp.request({
        method: "GET",
        url: RELEASES_FEED_URL,
        headers,
      });
      const xml = typeof res.data === "string" ? res.data : "";
      return { status: res.status, xml };
    } catch {
      return null;
    }
  }

  try {
    const res = await fetch(RELEASES_FEED_URL, {
      headers,
      signal,
      cache: "no-store",
    });
    const xml = await res.text();
    return { status: res.status, xml };
  } catch {
    return null;
  }
}

function apkUrlForTag(tag: string): string {
  const tagSegment = tag.startsWith("v") || tag.startsWith("V") ? tag : `v${tag}`;
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${tagSegment}/weather-app-${tagSegment}.apk`;
}

function buildUpdateInfo(release: GithubReleaseResponse): UpdateInfo | null {
  if (release.draft || release.prerelease) return null;

  const latestTag = typeof release.tag_name === "string" ? release.tag_name : "";
  if (!latestTag) return null;

  if (!isNewerVersion(APP_VERSION, latestTag)) return null;

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
 * Fetches releases from the Atom feed and returns update info iff a release is
 * strictly newer than the running app. Throttled in the background; pass
 * `{ force: true }` for a fresh network read. We still keep the last parsed
 * release in localStorage so a throttled check can surface a known upgrade
 * without hitting the network — that is not HTTP caching; every non-throttled
 * fetch always downloads the current feed XML.
 */
export async function checkForUpdate(
  opts: { force?: boolean; signal?: AbortSignal } = {},
): Promise<UpdateInfo | null> {
  const cachedRelease = readCachedRelease();

  if (!opts.force && shouldSkipCheck()) {
    return cachedRelease ? buildUpdateInfo(cachedRelease) : null;
  }

  let release: GithubReleaseResponse | null = cachedRelease;
  try {
    const fetched = await fetchReleasesFeed(opts.signal);
    if (!fetched) return null;
    if (fetched.status < 200 || fetched.status >= 300) return null;

    const parsed = parseAtomFeed(fetched.xml);
    const picked = pickHighestRelease(parsed);
    if (picked) {
      release = picked;
      writeCachedRelease(picked);
    }
  } catch {
    return null;
  } finally {
    markChecked();
  }

  return release ? buildUpdateInfo(release) : null;
}
