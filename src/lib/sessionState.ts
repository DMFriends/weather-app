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
 * `notifyAppResumed()` when the app comes back to the foreground. That clears
 * the bootstrap flag so the next refresh (either via the registered home
 * callback, or the next time the home page mounts) will fetch fresh data.
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
  bootstrapped = false;
  if (homeRefresh) void homeRefresh();
  // If no callback is registered (user is on a sub-page), the next home-page
  // mount will see `!isBootstrapped()` and refresh on its own.
}
