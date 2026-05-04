<script lang="ts">
	import { goto } from "$app/navigation";
	import { App } from "@capacitor/app";
	import type { PluginListenerHandle } from "@capacitor/core";
	import { LocalNotifications } from "@capacitor/local-notifications";
	import { setAlertNotificationsAppActive } from "$lib/weatherAlertNotifications";
	import { notifyAppResumed } from "$lib/sessionState";
	import {
		APP_VERSION,
		checkForUpdate,
		notifyUpdateAvailable,
		type UpdateInfo,
	} from "$lib/updateCheck";
	import { onDestroy, onMount } from "svelte";

	let { children } = $props();

	// Layout mounts once per app session and persists across SvelteKit client
	// navigations, so registering the appStateChange listener here means we get
	// resume notifications even when the user is on a sub-page (and we don't
	// re-register on every back-press).
	let appStateHandle: PluginListenerHandle | undefined;
	let notificationActionHandle: PluginListenerHandle | undefined;

	let updateInfo: UpdateInfo | null = $state(null);
	let manualChecking = $state(false);
	/** "" = no transient feedback, otherwise short toast text shown next to button. */
	let manualFeedback = $state("");

	async function runUpdateCheck() {
		try {
			const info = await checkForUpdate();
			if (info) {
				updateInfo = info;
				void notifyUpdateAvailable(info);
			}
		} catch (e) {
			console.error(e);
		}
	}

	async function onCheckForUpdatesClick() {
		// In-flight guard so spam-clicking doesn't fire parallel requests; no
		// persistent cooldown — the Atom feed has no rate limit to be polite to.
		if (manualChecking) return;
		manualChecking = true;
		manualFeedback = "";
		try {
			const info = await checkForUpdate({ force: true });
			if (info) {
				updateInfo = info;
				void notifyUpdateAvailable(info);
			} else {
				manualFeedback = "You're up to date";
				setTimeout(() => {
					manualFeedback = "";
				}, 4000);
			}
		} catch (e) {
			console.error(e);
			manualFeedback = "Check failed";
			setTimeout(() => {
				manualFeedback = "";
			}, 4000);
		} finally {
			manualChecking = false;
		}
	}

	function dismissUpdatePrompt() {
		updateInfo = null;
	}

	onMount(() => {
		void runUpdateCheck();

		void (async () => {
			try {
				appStateHandle = await App.addListener("appStateChange", (state) => {
					setAlertNotificationsAppActive(state.isActive);
					if (state.isActive) {
						notifyAppResumed();
						void runUpdateCheck();
					}
				});
				try {
					const st = await App.getState();
					setAlertNotificationsAppActive(st.isActive);
				} catch {
					/* noop */
				}
			} catch {
				// App plugin not available on web — nothing to do.
			}

			try {
				// Update notification → APK URL in browser. Weather alert notifications
				// carry `weatherAlertKey` → open /alerts with that alert highlighted.
				notificationActionHandle = await LocalNotifications.addListener(
					"localNotificationActionPerformed",
					(action) => {
						if (typeof window === "undefined") return;
						const extra = action?.notification?.extra as
							| Record<string, unknown>
							| undefined;
						const url = typeof extra?.url === "string" ? extra.url : undefined;
						const alertKey =
							typeof extra?.weatherAlertKey === "string"
								? extra.weatherAlertKey
								: undefined;
						if (url) {
							window.open(url, "_blank", "noopener,noreferrer");
							return;
						}
						if (alertKey) {
							void goto(`/alerts?alert=${encodeURIComponent(alertKey)}`);
						}
					},
				);
			} catch {
				// LocalNotifications plugin not available on web — ignore.
			}
		})();
	});

	onDestroy(() => {
		if (appStateHandle) {
			void appStateHandle.remove();
			appStateHandle = undefined;
		}
		if (notificationActionHandle) {
			void notificationActionHandle.remove();
			notificationActionHandle = undefined;
		}
	});
</script>

<svelte:head>
	<link rel="icon" href="/favicon.png" />
</svelte:head>

<div class="app">
	<main class="main">
		{#if updateInfo}
			<div class="update-banner" role="status" aria-live="polite">
				<div class="update-banner-text">
					<strong>Update available:</strong>
					<span>v{updateInfo.latestVersion} is out (you're on v{updateInfo.currentVersion}).</span>
				</div>
				<div class="update-banner-actions">
					<a
						class="update-banner-link"
						href={updateInfo.apkUrl}
						target="_blank"
						rel="noopener noreferrer"
					>
						Download
					</a>
					<button
						type="button"
						class="update-banner-dismiss"
						onclick={dismissUpdatePrompt}
						aria-label="Dismiss update notice"
					>
						×
					</button>
				</div>
			</div>
		{/if}

		{@render children()}
	</main>
	<footer class="app-footer">
		<span class="app-version" aria-label="App version">v{APP_VERSION}</span>
		<button
			type="button"
			class="check-updates-btn"
			onclick={onCheckForUpdatesClick}
			disabled={manualChecking}
			aria-label="Check for updates"
		>
			{#if manualChecking}
				Checking…
			{:else}
				Check for updates
			{/if}
		</button>
		{#if manualFeedback}
			<span class="check-updates-feedback" role="status" aria-live="polite">
				{manualFeedback}
			</span>
		{/if}
	</footer>
</div>

<style>
	:global(:root) {
		--bg: #f6f8ff;
		--surface: rgba(255, 255, 255, 0.78);
		--border: rgba(15, 23, 42, 0.12);
		--text: rgba(15, 23, 42, 0.92);
		--muted: rgba(15, 23, 42, 0.62);
		--shadow: 0 14px 40px rgba(15, 23, 42, 0.12);
		--maxw: 520px;
		--radius: 18px;
	}

	:global(html, body) {
		height: 100%;
	}

	:global(body) {
		margin: 0;
		color: var(--text);
		-webkit-text-size-adjust: 100%;
		text-size-adjust: 100%;
		font-family:
			ui-sans-serif,
			system-ui,
			-apple-system,
			Segoe UI,
			Roboto,
			Helvetica,
			Arial,
			"Noto Sans",
			"Apple Color Emoji",
			"Segoe UI Emoji";
		background: var(--bg);
	}

	:global(body)::before,
	:global(body)::after {
		content: "";
		position: fixed;
		inset: -20vmax;
		z-index: -1;
		pointer-events: none;
		background:
			radial-gradient(40vmax 28vmax at 20% 15%, rgba(69, 132, 255, 0.28), transparent 65%),
			radial-gradient(44vmax 30vmax at 85% 25%, rgba(0, 197, 255, 0.18), transparent 68%),
			radial-gradient(52vmax 40vmax at 55% 85%, rgba(255, 180, 70, 0.12), transparent 70%);
		filter: blur(2px);
	}

	:global(*) {
		box-sizing: border-box;
	}

	.app {
		min-height: 100dvh;
		padding: max(12px, env(safe-area-inset-top)) max(14px, env(safe-area-inset-right))
			max(14px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-left));
	}

	.main {
		max-width: var(--maxw);
		margin: 0 auto;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 16px;
		/* Allow popovers (e.g. city suggestions) to escape the card */
		overflow: visible;
	}

	@media (min-width: 720px) {
		.main {
			padding: 18px;
		}
	}

	.app-footer {
		max-width: var(--maxw);
		margin: 10px auto 0;
		padding: 4px 8px 8px;
		text-align: center;
		color: var(--muted);
		font-size: 0.75rem;
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 6px 10px;
	}

	.app-version {
		opacity: 0.85;
	}

	.check-updates-btn {
		font: inherit;
		font-size: 0.75rem;
		color: var(--muted);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 3px 10px;
		cursor: pointer;
		transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	.check-updates-btn:hover:not(:disabled) {
		background: rgba(15, 23, 42, 0.05);
		color: var(--text);
		border-color: rgba(15, 23, 42, 0.22);
	}

	.check-updates-btn:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.check-updates-feedback {
		opacity: 0.85;
		font-style: italic;
	}

	.update-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.6rem 0.85rem;
		margin: 0 0 0.75rem;
		border-radius: 10px;
		background: #e8f1ff;
		border: 1px solid #b8d4ff;
		color: #0b3c8a;
		font-size: clamp(0.82rem, 0.78rem + 0.25vw, 0.95rem);
		text-align: left;
	}

	.update-banner-text {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: baseline;
	}

	.update-banner-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.update-banner-link {
		color: #0b3c8a;
		font-weight: 600;
		text-decoration: underline;
		white-space: nowrap;
	}

	.update-banner-dismiss {
		padding: 0 0.5rem;
		font-size: 1.1rem;
		line-height: 1;
		background: transparent;
		border: 0;
		color: inherit;
		cursor: pointer;
		border-radius: 6px;
	}

	.update-banner-dismiss:hover {
		background: rgba(11, 60, 138, 0.1);
	}
</style>
