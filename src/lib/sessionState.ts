/**
 * Lightweight session-level state for the Weather App SPA.
 *
 * The SvelteKit layout mounts once per app session, while page components are
 * destroyed and re-mounted on every client-side navigation. To avoid hitting
 * the WeatherAPI on every back-press, we track whether the home page has
 * already done its initial bootstrap in this session. Module scope persists
 * across page remounts but is wiped when the app is fully closed and the JS
 * runtime is torn down.
 *
 * The layout listens for Capacitor's `appStateChange` and calls
 * `notifyAppResumed()` when the app comes back to the foreground. Resuming does
 * NOT re-trigger the current-location fetch: the bootstrap flag is left intact
 * (so a later home-page mount won't treat the resume as a fresh open), and the
 * registered home callback only handles lightweight resume housekeeping. The
 * current-location fetch happens only on a fresh launch, when the JS runtime
 * starts with `bootstrapped = false`.
 */

let bootstrapped = false;
let homeRefresh: (() => void | Promise<void>) | null = null;

export function isBootstrapped(): boolean {
  return bootstrapped;
}

export function markBootstrapped(): void {
  bootstrapped = true;
}

export function registerHomeRefresh(fn: () => void | Promise<void>): void {
  homeRefresh = fn;
}

export function unregisterHomeRefresh(fn: () => void | Promise<void>): void {
  if (homeRefresh === fn) homeRefresh = null;
}

/** Called by the layout when the app resumes from background. */
export function notifyAppResumed(): void {
  // Intentionally does not reset `bootstrapped`: resuming must not re-trigger the
  // current-location fetch, and must not make the next home mount behave like a
  // fresh open. The callback only runs lightweight resume housekeeping.
  if (homeRefresh) void homeRefresh();
}
