import { browser } from "$app/environment";
import { goto } from "$app/navigation";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { PUBLIC_API_KEY } from "$env/static/public";
import {
	formatTempPrecise,
	formatWindSpeed,
	loadInitialTempUnit,
	type TempUnit,
	type WeatherApiResponse,
} from "$lib/forecast";

const NOTIFICATION_ID = 71234;

export async function updateWeatherLocation(location: { lat: number; lon: number }) {
	if (!Capacitor.isNativePlatform()) return;

	const checked = await LocalNotifications.checkPermissions();
	if (checked.display !== "granted") {
		return;
	}

	if (Capacitor.getPlatform() === "android") {
		const unit = loadInitialTempUnit();
		await WeatherNativeNotification.sync({
			apiKey: PUBLIC_API_KEY,
			query: weatherQuery({ location }),
			tempUnit: unit,
		});
		return;
	}

	const snap = activeSnapshot;
	if (!snap?.weather) return;
	await postIosNotification(
		{
			...snap.weather,
			location: {
				...snap.weather.location,
				...location,
			},
		},
		snap.precipPct,
		snap.tempUnit
	);
}
const CHANNEL_ID = "current_weather";

/** Android: native notification; swipe-dismiss runs WeatherAPI with current device location. */
export const WeatherNativeNotification = registerPlugin<{
	sync: (opts: {
		apiKey: string;
		query: string;
		title?: string;
		body?: string;
		/** Persisted for background refresh ({@link WeatherSyncWorker}). F or C. */
		tempUnit?: TempUnit;
	}) => Promise<void>;
	cancelDisplay?: () => Promise<void>;
	requestExactAlarms?: () => Promise<void>;
	cancelWeatherAlertNotifications?: () => Promise<void>;
	scheduleWeatherAlertsFromForecastJson?: (opts: { forecastJson: string }) => Promise<void>;
	consumePendingAlertKey?: () => Promise<{ key?: string }>;
	clear: () => Promise<void>;
	/** Updates stored F/C for {@link WeatherSyncWorker} without touching alarms or posting. */
	setTempUnit: (opts: { tempUnit: TempUnit }) => Promise<void>;
}>("WeatherNativeNotification");

/** Persists metric/standard preference for native background refresh (Android {@link WeatherSyncWorker}). */
export async function persistAndroidNotificationTempPreference(unit: TempUnit) {
	if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
	try {
		await WeatherNativeNotification.setTempUnit({ tempUnit: unit });
	} catch {
		/* older native build */
	}
}

/** iOS only — re-post if user dismissed while the WebView is alive. */
const WATCH_MS = 3500;
const SCHEDULE_COOLDOWN_MS = 4000;

type WeatherNotifyPayload = {
	location: { name: string; lat: number; lon: number };
	current: { temp_f: number; wind_mph: number; wind_dir: string; wind_degree?: number };
};

type Snapshot = {
	weather: WeatherNotifyPayload;
	precipPct: number | null;
	tempUnit: TempUnit;
};

let channelEnsured = false;

let activeSnapshot: Snapshot | null = null;
let lastScheduleAt = 0;
let watchdogTimer: ReturnType<typeof setInterval> | undefined;
let onVisibility: (() => void) | undefined;

function weatherQuery(weather: { location: { lat: number; lon: number } }): string {
	return `${weather.location.lat},${weather.location.lon}`;
}

function toNotifyPayload(w: WeatherApiResponse | WeatherNotifyPayload): WeatherNotifyPayload {
	if ("forecast" in w && w.forecast != null) {
		return { location: w.location, current: w.current };
	}
	return w;
}

export function formatWeatherNotificationBody(
	weather: WeatherApiResponse | WeatherNotifyPayload,
	precipPct: number | null,
	unit: TempUnit
): string {
	const w = toNotifyPayload(weather);
	const precip = precipPct ?? 0;
	const deg =
		typeof w.current.wind_degree === "number" && Number.isFinite(w.current.wind_degree)
			? ` (${Math.round(w.current.wind_degree)}°)`
			: "";
	return `${formatTempPrecise(w.current.temp_f, unit)} · ${formatWindSpeed(w.current.wind_mph, unit)} ${w.current.wind_dir}${deg} · ${precip}% precip`;
}

async function ensureIosChannel() {
	if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return;
	if (channelEnsured) return;
	await LocalNotifications.createChannel({
		id: CHANNEL_ID,
		name: "Current weather",
		description: "Live conditions from WeatherAPI.",
		importance: 3,
		vibration: false,
	});
	channelEnsured = true;
}

function stopWatchdog() {
	if (watchdogTimer !== undefined) {
		clearInterval(watchdogTimer);
		watchdogTimer = undefined;
	}
	if (onVisibility !== undefined && typeof document !== "undefined") {
		document.removeEventListener("visibilitychange", onVisibility);
		onVisibility = undefined;
	}
}

function startIosWatchdog() {
	if (Capacitor.getPlatform() !== "ios") return;
	stopWatchdog();
	void restoreIosIfMissing();
	watchdogTimer = setInterval(() => void restoreIosIfMissing(), WATCH_MS);
	onVisibility = () => {
		if (typeof document !== "undefined" && !document.hidden) {
			void restoreIosIfMissing();
		}
	};
	if (typeof document !== "undefined") {
		document.addEventListener("visibilitychange", onVisibility);
	}
}

async function postIosNotification(
	weather: WeatherNotifyPayload,
	precipPct: number | null,
	tempUnit: TempUnit
) {
	await ensureIosChannel();
	const title = weather.location.name;
	const body = formatWeatherNotificationBody(weather, precipPct, tempUnit);

	await LocalNotifications.schedule({
		notifications: [
			{
				id: NOTIFICATION_ID,
				title,
				body,
			},
		],
	});
	lastScheduleAt = Date.now();
}

async function restoreIosIfMissing() {
	if (!activeSnapshot) return;
	if (Date.now() - lastScheduleAt < SCHEDULE_COOLDOWN_MS) return;
	try {
		const { notifications } = await LocalNotifications.getDeliveredNotifications();
		const stillThere = notifications.some((n) => n.id === NOTIFICATION_ID);
		if (stillThere) return;
		await postIosNotification(activeSnapshot.weather, activeSnapshot.precipPct, activeSnapshot.tempUnit);
	} catch (e) {
		console.warn("weather notification watchdog", e);
	}
}

export async function syncWeatherNotification(
	weather: WeatherApiResponse | WeatherNotifyPayload,
	precipPct: number | null,
	tempUnit?: TempUnit
) {
	if (!Capacitor.isNativePlatform()) return;

	const unit = tempUnit ?? loadInitialTempUnit();
	const payload = toNotifyPayload(weather);

	const checked = await LocalNotifications.checkPermissions();
	if (checked.display !== "granted") {
		const requested = await LocalNotifications.requestPermissions();
		if (requested.display !== "granted") return;
	}

	if (Capacitor.getPlatform() === "android") {
		activeSnapshot = { weather: payload, precipPct, tempUnit: unit };

		const title = payload.location.name;
		const body = formatWeatherNotificationBody(payload, precipPct, unit);

		try {
			await WeatherNativeNotification.requestExactAlarms?.();
		} catch {
			/* noop */
		}

		await WeatherNativeNotification.sync({
			apiKey: PUBLIC_API_KEY,
			query: weatherQuery(payload),
			title,
			body,
			tempUnit: unit,
		});
		return;
	}

	activeSnapshot = { weather: payload, precipPct, tempUnit: unit };
	await postIosNotification(payload, precipPct, unit);
	startIosWatchdog();
}

export async function clearWeatherNotification() {
	if (!Capacitor.isNativePlatform()) return;
	stopWatchdog();
	activeSnapshot = null;

	if (Capacitor.getPlatform() === "android") {
		try {
			await WeatherNativeNotification.cancelDisplay?.();
		} catch {
			/* noop */
		}
		return;
	}

	try {
		await LocalNotifications.cancel({ notifications: [{ id: NOTIFICATION_ID }] });
	} catch {
		/* noop */
	}
}

/** Pending navigation after tapping an alert notification posted from native ({@link WeatherAlertNotifier}). */
export async function consumeAndroidPendingAlertDeepLink(): Promise<void> {
	if (!browser || Capacitor.getPlatform() !== "android") return;
	try {
		const out = await WeatherNativeNotification.consumePendingAlertKey?.();
		const key = out?.key;
		if (typeof key === "string" && key.length > 0) {
			await goto(`/alerts?alert=${encodeURIComponent(key)}`);
		}
	} catch {
		/* noop */
	}
}

/**
 * Cold opens can fire `appStateChange` before layout mounts its listener. Flush pending alert
 * navigation several times and hook `resume` elsewhere — cheap no-op when nothing pending.
 */
export function scheduleConsumeAndroidPendingAlertDeepLinks(): void {
	if (!browser || Capacitor.getPlatform() !== "android") return;
	void consumeAndroidPendingAlertDeepLink();
	queueMicrotask(() => void consumeAndroidPendingAlertDeepLink());
	requestAnimationFrame(() => void consumeAndroidPendingAlertDeepLink());
	setTimeout(() => void consumeAndroidPendingAlertDeepLink(), 120);
	setTimeout(() => void consumeAndroidPendingAlertDeepLink(), 450);
	setTimeout(() => void consumeAndroidPendingAlertDeepLink(), 1200);
}
