import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { weatherAlertDedupKey, type WeatherApiAlert, type WeatherApiLocation } from "$lib/forecast";
import { WeatherNativeNotification } from "$lib/weatherNotification";

/**
 * Alert notifications use Android reserved int ids `80_000..89_999` for cancel sweep compatibility.
 * Native `WeatherAlertNotifier` assigns sequential ids per refresh within that band.
 * OS scheduling runs only when the forecast location changes or the active alert set changes — not on every
 * app open with unchanged data (see `pushAlertNotificationsIfNeeded`).
 * On Android, only native posts alerts (worker + `scheduleWeatherAlertsFromForecastJson`) so Capacitor
 * does not duplicate OS notifications with different tags for the same id.
 */

const WeatherAlertDedup = registerPlugin<{
  loadNotifiedMap: () => Promise<{ json?: string }>;
  saveNotifiedMap: (opts: { json: string }) => Promise<void>;
  clearNotifiedMap: () => Promise<void>;
  maybeClearDedupForLocation: (opts: { lat: number; lon: number }) => Promise<void>;
}>("WeatherAlertDedup");

const STORAGE_KEY = "weather-app:notified-alerts:v1";
const ALERT_CHANNEL_ID = "weather_alerts";

const ALERT_NOTIFICATION_ID_BASE = 80_000;
const ALERT_NOTIFICATION_ID_RANGE = 9_000;

type NotifiedMap = Record<string, number>;

let alertChannelEnsured = false;

/** Last forecast coordinates for web/iOS dedup clearing only */
let lastAlertNotifyLocationKey: string | null = null;

let lastAlertsSnapshot: WeatherApiAlert[] = [];
/** Used when re-scheduling from native lifecycle (same lat/lon as last forecast sync). */
let lastAlertLocation: WeatherApiLocation | null = null;

/** Last coordinates + alert-set fingerprint we successfully pushed to the OS (native skip gate). */
let lastPushedAlertsLocationKey: string | null = null;
let lastPushedAlertsFingerprint: string | null = null;

let alertExpiryRecheckTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleLocationKey(loc: { lat: number; lon: number } | null): string | null {
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return null;
  return `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
}

function parseExpires(s: string | undefined): number {
  if (!s) return Date.now() + 24 * 3600 * 1000;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : Date.now() + 24 * 3600 * 1000;
}

/** Alerts that are still within their expiry window (matches OS scheduling). */
function filterActiveAlerts(alerts: WeatherApiAlert[], now = Date.now()): WeatherApiAlert[] {
  return (alerts ?? []).filter((a) => parseExpires(a.expires) >= now);
}

/** Stable fingerprint of non-expired alerts for comparing sets across opens (sorted dedup keys). */
function activeAlertsFingerprint(alerts: WeatherApiAlert[]): string {
  const keys = filterActiveAlerts(alerts)
    .map((a) => weatherAlertDedupKey(a))
    .filter((k) => k.replace(/\|/g, "").trim() !== "")
    .sort();
  return JSON.stringify(keys);
}

/** Re-sync OS notifications when the next alert expires without waiting for a forecast refresh. */
function scheduleActiveAlertExpiryRecheck(alerts: WeatherApiAlert[]): void {
  if (alertExpiryRecheckTimer !== undefined) {
    clearTimeout(alertExpiryRecheckTimer);
    alertExpiryRecheckTimer = undefined;
  }
  if (!Capacitor.isNativePlatform()) return;

  const now = Date.now();
  let nextExpiryMs = Infinity;
  for (const a of alerts ?? []) {
    const exp = parseExpires(a.expires);
    if (exp > now) nextExpiryMs = Math.min(nextExpiryMs, exp);
  }
  if (!Number.isFinite(nextExpiryMs)) return;

  const delay = Math.min(Math.max(0, nextExpiryMs - now + 500), 24 * 3600 * 1000);
  alertExpiryRecheckTimer = setTimeout(() => {
    alertExpiryRecheckTimer = undefined;
    void pushAlertNotificationsIfNeeded(lastAlertsSnapshot);
    scheduleActiveAlertExpiryRecheck(lastAlertsSnapshot);
  }, delay);
}

async function pushAlertNotificationsIfNeeded(alerts: WeatherApiAlert[]): Promise<void> {
  const locKey = scheduleLocationKey(lastAlertLocation);
  const fp = activeAlertsFingerprint(alerts ?? []);

  const unchanged =
    lastPushedAlertsFingerprint === fp && lastPushedAlertsLocationKey === locKey;

  if (unchanged) {
    // Recover from a prior failed OS cancel (e.g. Android tag mismatch) when nothing is active.
    if (fp === "[]" && Capacitor.isNativePlatform()) {
      await cancelAllWeatherAlertOsNotifications();
    }
    return;
  }

  const ok = await schedulePendingAlertNotifications(filterActiveAlerts(alerts ?? []));
  if (ok) {
    lastPushedAlertsLocationKey = locKey;
    lastPushedAlertsFingerprint = fp;
  }
}

export function setAlertNotificationsAppActive(_isActive: boolean): void {
  void pushAlertNotificationsIfNeeded(lastAlertsSnapshot);
}

function parseNotifiedJson(raw: string): NotifiedMap {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: NotifiedMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
      }
      return out;
    }
  } catch {
    /* noop */
  }
  return {};
}

async function readNotified(): Promise<NotifiedMap> {
  if (Capacitor.getPlatform() === "android") {
    try {
      const { json } = await WeatherAlertDedup.loadNotifiedMap();
      return parseNotifiedJson(typeof json === "string" ? json : "{}");
    } catch {
      return {};
    }
  }

  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return parseNotifiedJson(raw);
  } catch {
    return {};
  }
}

async function writeNotified(map: NotifiedMap): Promise<void> {
  const payload = JSON.stringify(map);
  if (Capacitor.getPlatform() === "android") {
    try {
      await WeatherAlertDedup.saveNotifiedMap({ json: payload });
    } catch {
      /* noop */
    }
    return;
  }

  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, payload);
  } catch {
    /* quota / private mode */
  }
}

async function clearNotifiedDedupWebIos(): Promise<void> {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

/** Clear stored dedup keys (Android plugin or web/localStorage). */
async function resetWeatherAlertDedupOnly(): Promise<void> {
  if (Capacitor.getPlatform() === "android") {
    try {
      await WeatherAlertDedup.clearNotifiedMap();
    } catch {
      /* noop */
    }
    return;
  }
  await clearNotifiedDedupWebIos();
}

function isAlertBandId(id: number): boolean {
  return id >= ALERT_NOTIFICATION_ID_BASE && id < ALERT_NOTIFICATION_ID_BASE + ALERT_NOTIFICATION_ID_RANGE;
}

/** Remove Capacitor-tracked delivered + pending alert notifications; Android also clears native-posted band. */
async function cancelAllWeatherAlertOsNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const [{ notifications: delivered }, { notifications: pending }] = await Promise.all([
      LocalNotifications.getDeliveredNotifications(),
      LocalNotifications.getPending(),
    ]);
    const ids = new Set<number>();
    for (const n of delivered ?? []) {
      if (typeof n.id === "number" && isAlertBandId(n.id)) ids.add(n.id);
    }
    for (const n of pending ?? []) {
      if (typeof n.id === "number" && isAlertBandId(n.id)) ids.add(n.id);
    }
    if (ids.size > 0) {
      await LocalNotifications.cancel({
        notifications: [...ids].map((id) => ({ id })),
      });
    }
  } catch {
    /* noop */
  }

  if (Capacitor.getPlatform() === "android") {
    try {
      await WeatherNativeNotification.cancelWeatherAlertNotifications?.();
    } catch {
      /* noop */
    }
  }
}

function hashForId(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % ALERT_NOTIFICATION_ID_RANGE;
}

async function ensureAlertChannel() {
  if (Capacitor.getPlatform() !== "android") return;
  if (alertChannelEnsured) return;
  try {
    await LocalNotifications.createChannel({
      id: ALERT_CHANNEL_ID,
      name: "Weather alerts",
      description: "Severe weather alerts for your saved location.",
      importance: 4,
      vibration: true,
    });
    alertChannelEnsured = true;
  } catch {
    /* ignore */
  }
}

/** Minimal forecast root for {@link WeatherAlertNotifier} / WeatherSyncWorker parity. */
function buildForecastRootJsonForNative(
  alerts: WeatherApiAlert[],
  location: WeatherApiLocation | null,
): string {
  const root: Record<string, unknown> = {
    alerts: { alert: filterActiveAlerts(alerts) },
  };
  if (
    location &&
    Number.isFinite(location.lat) &&
    Number.isFinite(location.lon)
  ) {
    const locPayload: Record<string, unknown> = {
      lat: location.lat,
      lon: location.lon,
    };
    if (location.name) locPayload.name = location.name;
    if (location.region != null && String(location.region).trim() !== "") {
      locPayload.region = location.region;
    }
    if (location.country != null && String(location.country).trim() !== "") {
      locPayload.country = location.country;
    }
    root.location = locPayload;
  }
  return JSON.stringify(root);
}

function buildBody(a: WeatherApiAlert): string {
  if (a.headline) return a.headline;
  if (a.desc) {
    const trimmed = a.desc.trim().replace(/\s+/g, " ");
    return trimmed.length > 200 ? `${trimmed.slice(0, 197)}…` : trimmed;
  }
  if (a.areas) return a.areas;
  return "Tap to view details.";
}

export async function syncAlertNotifications(
  alerts: WeatherApiAlert[],
  location?: WeatherApiLocation | null,
): Promise<void> {
  lastAlertsSnapshot = alerts ?? [];
  if (
    location &&
    Number.isFinite(location.lat) &&
    Number.isFinite(location.lon)
  ) {
    lastAlertLocation = {
      name: location.name,
      lat: location.lat,
      lon: location.lon,
      region: location.region,
      country: location.country,
    };
    if (Capacitor.getPlatform() === "android") {
      try {
        await WeatherAlertDedup.maybeClearDedupForLocation({
          lat: location.lat,
          lon: location.lon,
        });
      } catch {
        /* older APK without plugin */
      }
    } else {
      const locKey = `${location.lat.toFixed(3)},${location.lon.toFixed(3)}`;
      if (lastAlertNotifyLocationKey !== null && lastAlertNotifyLocationKey !== locKey) {
        await clearNotifiedDedupWebIos();
      }
      lastAlertNotifyLocationKey = locKey;
    }
  }

  if (!Capacitor.isNativePlatform()) return;
  scheduleActiveAlertExpiryRecheck(lastAlertsSnapshot);
  await pushAlertNotificationsIfNeeded(lastAlertsSnapshot);
}

async function ensureNotifyPermissions(): Promise<boolean> {
  try {
    const checked = await LocalNotifications.checkPermissions();
    if (checked.display !== "granted") {
      const requested = await LocalNotifications.requestPermissions();
      return requested.display === "granted";
    }
    return true;
  } catch {
    return false;
  }
}

/** Returns whether scheduling completed so callers may record last-pushed fingerprint state. */
async function schedulePendingAlertNotifications(alerts: WeatherApiAlert[]): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  await cancelAllWeatherAlertOsNotifications();
  await resetWeatherAlertDedupOnly();

  if (!(await ensureNotifyPermissions())) {
    await writeNotified({});
    return false;
  }

  if (Capacitor.getPlatform() === "android") {
    try {
      await WeatherNativeNotification.scheduleWeatherAlertsFromForecastJson?.({
        forecastJson: buildForecastRootJsonForNative(alerts ?? [], lastAlertLocation),
      });
      return true;
    } catch (e) {
      console.warn("native weather alert schedule failed", e);
      return false;
    }
  }

  await ensureAlertChannel();

  if (!alerts?.length) {
    await writeNotified({});
    return true;
  }

  const now = Date.now();
  const notified: NotifiedMap = {};
  const toSchedule: {
    id: number;
    title: string;
    body: string;
    extra: Record<string, string>;
  }[] = [];
  const usedIds = new Set<number>();

  for (const a of alerts) {
    const key = weatherAlertDedupKey(a);
    if (!key || key.replace(/\|/g, "").trim() === "") continue;

    const expiresMs = parseExpires(a.expires);
    if (expiresMs < now) continue;

    notified[key] = expiresMs;

    let id = ALERT_NOTIFICATION_ID_BASE + hashForId(key);
    while (usedIds.has(id)) id++;
    usedIds.add(id);

    toSchedule.push({
      id,
      title: a.event || a.headline || "Weather alert",
      body: buildBody(a),
      extra: { weatherAlertKey: key },
    });
  }

  if (!toSchedule.length) {
    await writeNotified(notified);
    return true;
  }

  try {
    await LocalNotifications.schedule({
      notifications: toSchedule.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        channelId: ALERT_CHANNEL_ID,
        extra: n.extra,
      })),
    });
    await writeNotified(notified);
    return true;
  } catch (e) {
    console.warn("alert notification schedule failed", e);
    return false;
  }
}

/** Forget notified-alert dedup keys (does not touch native weather notification prefs). */
export async function clearNotifiedAlerts(): Promise<void> {
  lastPushedAlertsLocationKey = null;
  lastPushedAlertsFingerprint = null;
  await resetWeatherAlertDedupOnly();
}

/** Read current dedup map (e.g. diagnostics). */
export async function readWeatherAlertDedupForTest(): Promise<NotifiedMap> {
  return readNotified();
}
