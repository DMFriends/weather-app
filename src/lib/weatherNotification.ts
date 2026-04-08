import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { PUBLIC_API_KEY } from "$env/static/public";

const NOTIFICATION_ID = 71234;
const CHANNEL_ID = "current_weather";

/** Android: native WorkManager + dismiss receiver (updates while app closed, reposts when swiped). */
const WeatherNativeNotification = registerPlugin<{
	sync: (opts: { apiKey: string; query: string; title: string; body: string }) => Promise<void>;
	requestExactAlarms?: () => Promise<void>;
	clear: () => Promise<void>;
}>("WeatherNativeNotification");

/** iOS only — re-post if user dismissed while the WebView is alive. */
const WATCH_MS = 3500;
const SCHEDULE_COOLDOWN_MS = 4000;

type WeatherNotifyPayload = {
	location: { name: string; lat: number; lon: number };
	current: { temp_f: number; wind_mph: number; wind_dir: string };
};

type Snapshot = {
	weather: WeatherNotifyPayload;
	precipPct: number | null;
};

let channelEnsured = false;

let activeSnapshot: Snapshot | null = null;
let lastScheduleAt = 0;
let watchdogTimer: ReturnType<typeof setInterval> | undefined;
let onVisibility: (() => void) | undefined;

function weatherQuery(weather: WeatherNotifyPayload): string {
	return `${weather.location.lat},${weather.location.lon}`;
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

async function ensureAndroidChannel() {
	if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
	// `createChannel` is Android-only; safe to call multiple times.
	await LocalNotifications.createChannel({
		id: CHANNEL_ID,
		name: "Current weather",
		description: "Live conditions from WeatherAPI.",
		importance: 3,
		vibration: false,
	});
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

async function postIosNotification(weather: WeatherNotifyPayload, precipPct: number | null) {
	await ensureIosChannel();
	const title = weather.location.name;
	const precip = precipPct ?? 0;
	const body = `${weather.current.temp_f.toFixed(1)} °F · ${weather.current.wind_mph.toFixed(0)} mph ${weather.current.wind_dir} · ${precip}% precip`;

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
		await postIosNotification(activeSnapshot.weather, activeSnapshot.precipPct);
	} catch (e) {
		console.warn("weather notification watchdog", e);
	}
}

export async function syncWeatherNotification(
	weather: WeatherNotifyPayload,
	precipPct: number | null
) {
	if (!Capacitor.isNativePlatform()) return;

	const checked = await LocalNotifications.checkPermissions();
	if (checked.display !== "granted") {
		const requested = await LocalNotifications.requestPermissions();
		if (requested.display !== "granted") return;
	}

	if (Capacitor.getPlatform() === "android") {
		activeSnapshot = { weather, precipPct };

		const title = weather.location.name;
		const precip = precipPct ?? 0;
		const body = `${weather.current.temp_f.toFixed(1)} °F · ${weather.current.wind_mph.toFixed(0)} mph ${weather.current.wind_dir} · ${precip}% precip`;

		// If available, prompt Android 12+ to allow exact alarms for reliable refresh cadence.
		try {
			await WeatherNativeNotification.requestExactAlarms?.();
		} catch {
			/* noop */
		}

		await WeatherNativeNotification.sync({
			apiKey: PUBLIC_API_KEY,
			query: weatherQuery(weather),
			title,
			body,
		});
		return;
	}

	activeSnapshot = { weather, precipPct };
	await postIosNotification(weather, precipPct);
	startIosWatchdog();
}

export async function clearWeatherNotification() {
	if (!Capacitor.isNativePlatform()) return;
	stopWatchdog();
	activeSnapshot = null;

	if (Capacitor.getPlatform() === "android") {
		try {
			await WeatherNativeNotification.clear();
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
