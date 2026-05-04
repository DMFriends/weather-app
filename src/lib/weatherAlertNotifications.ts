import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { weatherAlertDedupKey, type WeatherApiAlert } from "$lib/forecast";

/**
 * Posts a one-shot Capacitor LocalNotification per active weather alert. We
 * keep a localStorage-backed dedup set keyed by event/headline/effective so
 * the same alert isn't re-fired every time the forecast cache refreshes.
 *
 * Notifications are scheduled only while the app is in the background so we
 * don't interrupt someone who already has the UI open. The latest alert list is
 * stored on each sync and flushed when the app moves to the background.
 */

const STORAGE_KEY = "weather-app:notified-alerts:v1";
const ALERT_CHANNEL_ID = "weather_alerts";

// Local-notification IDs need to be 32-bit ints unique per scheduled notification.
// Reserve a band well above the persistent current-weather notification (71234)
// in `weatherNotification.ts`.
const ALERT_NOTIFICATION_ID_BASE = 80_000;
const ALERT_NOTIFICATION_ID_RANGE = 9_000;

type NotifiedMap = Record<string, number>; // key -> expires-at epoch ms

let alertChannelEnsured = false;

/** `true` while the user might see the in-app alert UI (Capacitor `AppState.isActive`). */
let appForegroundActive = true;

let lastAlertsSnapshot: WeatherApiAlert[] = [];

/**
 * Wire from `App.addListener('appStateChange')`: pass `state.isActive`.
 * When the app goes inactive we schedule any pending alert notifications from
 * the last forecast sync.
 */
export function setAlertNotificationsAppActive(isActive: boolean): void {
  appForegroundActive = isActive;
  if (!isActive) {
    void schedulePendingAlertNotifications(lastAlertsSnapshot);
  }
}

function readNotified(): NotifiedMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: NotifiedMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function writeNotified(map: NotifiedMap) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode */
  }
}

function pruneExpired(map: NotifiedMap) {
  const now = Date.now();
  for (const k of Object.keys(map)) {
    if (map[k] < now) delete map[k];
  }
}

/** Stable hash → 0..ALERT_NOTIFICATION_ID_RANGE for a notification id. */
function hashForId(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % ALERT_NOTIFICATION_ID_RANGE;
}

function parseExpires(s: string | undefined): number {
  if (!s) return Date.now() + 24 * 3600 * 1000;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : Date.now() + 24 * 3600 * 1000;
}

async function ensureAlertChannel() {
  if (Capacitor.getPlatform() !== "android") return;
  if (alertChannelEnsured) return;
  try {
    await LocalNotifications.createChannel({
      id: ALERT_CHANNEL_ID,
      name: "Weather alerts",
      description: "Severe weather alerts for your saved location.",
      importance: 4, // HIGH — heads-up notification
      vibration: true,
    });
    alertChannelEnsured = true;
  } catch {
    /* createChannel is android-only; ignore on other platforms */
  }
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

export async function syncAlertNotifications(alerts: WeatherApiAlert[]): Promise<void> {
  lastAlertsSnapshot = alerts ?? [];
  if (!Capacitor.isNativePlatform()) return;
  if (appForegroundActive) return;
  await schedulePendingAlertNotifications(lastAlertsSnapshot);
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

async function schedulePendingAlertNotifications(alerts: WeatherApiAlert[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!alerts?.length) return;

  if (!(await ensureNotifyPermissions())) return;

  await ensureAlertChannel();

  const notified = readNotified();
  pruneExpired(notified);

  const now = Date.now();
  const toSchedule: {
    id: number;
    title: string;
    body: string;
    extra: Record<string, string>;
  }[] = [];
  const usedIds = new Set<number>();

  for (const a of alerts) {
    const key = weatherAlertDedupKey(a);
    if (!key || key === "|||") continue;
    if (notified[key]) continue;

    const expiresMs = parseExpires(a.expires);
    if (expiresMs < now) continue; // already in the past

    notified[key] = expiresMs;

    let id = ALERT_NOTIFICATION_ID_BASE + hashForId(key);
    while (usedIds.has(id)) id++; // resolve rare hash collisions within this batch
    usedIds.add(id);

    toSchedule.push({
      id,
      title: a.event || a.headline || "Weather alert",
      body: buildBody(a),
      extra: { weatherAlertKey: key },
    });
  }

  if (!toSchedule.length) return;

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
    writeNotified(notified);
  } catch (e) {
    console.warn("alert notification schedule failed", e);
  }
}

/** Forget all dedup keys (e.g. when the active location changes). */
export function clearNotifiedAlerts(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
