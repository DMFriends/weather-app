import { goto } from "$app/navigation";
import type { PluginListenerHandle } from "@capacitor/core";
import { Capacitor } from "@capacitor/core";
import type { ActionPerformed } from "@capacitor/local-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";

let tapListenerHandle: PluginListenerHandle | undefined;

function readWeatherAlertKey(extra: unknown): string | undefined {
	if (!extra || typeof extra !== "object") return undefined;
	const rec = extra as Record<string, unknown>;
	const v = rec.weatherAlertKey;
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

function handleAlertNotificationAction(action: ActionPerformed): void {
	if (typeof window === "undefined") return;
	const extra = action?.notification?.extra;
	const url =
		extra && typeof extra === "object" && typeof (extra as Record<string, unknown>).url === "string"
			? (extra as Record<string, unknown>).url
			: undefined;
	const alertKey = readWeatherAlertKey(extra);

	if (typeof url === "string" && url.length > 0) {
		window.open(url, "_blank", "noopener,noreferrer");
		return;
	}
	if (alertKey) {
		void goto(`/alerts?alert=${encodeURIComponent(alertKey)}`);
	}
}

/**
 * Subscribe as early as possible on native so a tap isn’t missed before layout mounts
 * (cold start). Safe to call multiple times — registers once.
 */
export async function ensureWeatherAlertNotificationTapRouting(): Promise<void> {
	if (!Capacitor.isNativePlatform()) return;
	if (tapListenerHandle) return;
	try {
		tapListenerHandle = await LocalNotifications.addListener(
			"localNotificationActionPerformed",
			handleAlertNotificationAction,
		);
	} catch {
		/* LocalNotifications unavailable */
	}
}

export async function disposeWeatherAlertNotificationTapRouting(): Promise<void> {
	if (!tapListenerHandle) return;
	await tapListenerHandle.remove();
	tapListenerHandle = undefined;
}
