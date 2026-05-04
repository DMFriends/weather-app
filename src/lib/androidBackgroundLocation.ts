import { Capacitor, registerPlugin } from "@capacitor/core";

const DISMISS_STORAGE_KEY = "weather_android_bg_location_dismiss_v1";

const BackgroundLocationPermission = registerPlugin<{
	getStatus(): Promise<{
		supported: boolean;
		foregroundGranted: boolean;
		backgroundGranted: boolean;
	}>;
	requestIfNeeded(): Promise<{ granted: boolean }>;
}>("BackgroundLocationPermission");

export async function androidBackgroundNeedsPrompt(): Promise<boolean> {
	if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return false;
	if (typeof localStorage === "undefined") return false;
	if (localStorage.getItem(DISMISS_STORAGE_KEY) === "1") return false;
	try {
		const s = await BackgroundLocationPermission.getStatus();
		return s.supported && s.foregroundGranted && !s.backgroundGranted;
	} catch {
		return false;
	}
}

/** User-facing step after rationale; invokes the OS background-location sheet / settings path. */
export async function requestAndroidBackgroundLocation(): Promise<{ granted: boolean }> {
	return BackgroundLocationPermission.requestIfNeeded();
}

export function persistAndroidBackgroundLocationDismiss() {
	try {
		localStorage.setItem(DISMISS_STORAGE_KEY, "1");
	} catch {
		/* quota / privacy mode */
	}
}
