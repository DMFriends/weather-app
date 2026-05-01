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

const DISMISSED_VERSION_KEY = "weather-app:updateCheck:dismissedVersion";
const LAST_CHECK_AT_KEY = "weather-app:updateCheck:lastCheckAt";
const ETAG_KEY = "weather-app:updateCheck:etag";
const CACHED_RELEASE_KEY = "weather-app:updateCheck:cachedRelease";
const NOTIFIED_VERSION_KEY = "weather-app:updateCheck:notifiedVersion";

/** Stable id so the OS coalesces repeat notifications instead of stacking. */
const UPDATE_NOTIFICATION_ID = 84217;
/**
 * Throttle for the *first* (uncached) check. We're hitting the public Atom
 * feed — no rate limits — but still want a sane cadence so we're not making
 * a network round-trip on every single app open.
 */
const COLD_CHECK_THROTTLE_MS = 60 * 60 * 1000;
/**
 * Throttle once we have an ETag cached. 304 Not Modified responses are very
 * cheap on github.com, so this can be aggressive — 30 min gives a snappy
 * notification after a release without making the app feel chatty.
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
 *
 * Implemented with a small regex rather than DOMParser because (a) the feed
 * structure is simple and stable, (b) DOMParser handling of XML namespaces
 * (`xmlns="http://www.w3.org/2005/Atom"`) is inconsistent across engines,
 * and (c) we already trust the source.
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
 * Fetch the Atom feed using `CapacitorHttp` on native (which bypasses the
 * webview's CORS restrictions — github.com doesn't set CORS headers, so a
 * plain `fetch()` would otherwise be blocked). Falls back to a regular
 * `fetch()` on web; that will fail in browsers due to CORS, which is fine
 * because the update-check feature is intended for native installs anyway.
 */
async function fetchReleasesFeed(
  signal: AbortSignal | undefined,
  cachedEtag: string | null,
): Promise<{ status: number; xml: string; etag: string | null } | null> {
  const headers: Record<string, string> = { Accept: "application/atom+xml" };
  if (cachedEtag) headers["If-None-Match"] = cachedEtag;

  if (Capacitor.isNativePlatform()) {
    try {
      const res = await CapacitorHttp.request({
        method: "GET",
        url: RELEASES_FEED_URL,
        headers,
      });
      // CapacitorHttp normalizes header names inconsistently across
      // platforms; check both casings.
      const respHeaders = (res.headers ?? {}) as Record<string, string>;
      const etag = respHeaders.ETag ?? respHeaders.etag ?? null;
      const xml = typeof res.data === "string" ? res.data : "";
      return { status: res.status, xml, etag };
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
    return { status: res.status, xml, etag: res.headers.get("ETag") };
  } catch {
    return null;
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
 * Fetches the latest GitHub release (via the public Atom feed) and returns
 * info about it iff it is strictly newer than the running app version AND
 * the user has not already dismissed that specific version. Returns null
 * otherwise (including on network errors — update prompts are best-effort,
 * never blocking).
 *
 * Uses a stored ETag + `If-None-Match` so steady-state checks come back as
 * 304 Not Modified, which is essentially free for github.com to serve. We
 * also re-evaluate the cached payload on every call so things like a fresh
 * install (older APP_VERSION) or a newly un-dismissed version surface
 * immediately without waiting for a release on GitHub to change.
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

  let release: GithubReleaseResponse | null = cachedRelease;
  try {
    const fetched = await fetchReleasesFeed(opts.signal, cachedEtag);
    if (!fetched) return null;

    if (fetched.status === 304) {
      // Not modified — nothing to update, fall through using cached release.
    } else if (fetched.status >= 200 && fetched.status < 300) {
      const parsed = parseAtomFeed(fetched.xml);
      const picked = pickHighestRelease(parsed);
      if (picked) {
        release = picked;
        // Only persist when we actually found a usable release; an empty feed
        // (or a parse failure) shouldn't blow away a previously-good cache.
        writeCache(fetched.etag, picked);
      }
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
