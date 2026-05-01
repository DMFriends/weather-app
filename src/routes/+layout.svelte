<script lang="ts">
	import { App } from "@capacitor/app";
	import type { PluginListenerHandle } from "@capacitor/core";
	import { LocalNotifications } from "@capacitor/local-notifications";
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
		// In-memory only — we deliberately don't persist a "dismissed" version
		// anywhere, so the next check (auto on resume, or manual via the
		// footer button) re-surfaces the popup if the update is still out.
		updateInfo = null;
	}

	function onWindowKeydown(e: KeyboardEvent) {
		if (updateInfo && e.key === "Escape") {
			e.preventDefault();
			dismissUpdatePrompt();
		}
	}

	onMount(() => {
		void runUpdateCheck();

		void (async () => {
			try {
				appStateHandle = await App.addListener("appStateChange", (state) => {
					if (state.isActive) {
						notifyAppResumed();
						void runUpdateCheck();
					}
				});
			} catch {
				// App plugin not available on web — nothing to do.
			}

			try {
				// Tap on the "update available" notification → open the GitHub
				// release page in the system browser. Other notifications (the
				// weather one) carry no `url` extra, so this is a no-op for them.
				notificationActionHandle = await LocalNotifications.addListener(
					"localNotificationActionPerformed",
					(action) => {
						const url = action?.notification?.extra?.url as string | undefined;
						if (url && typeof window !== "undefined") {
							window.open(url, "_blank", "noopener,noreferrer");
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

<svelte:window onkeydown={onWindowKeydown} />

<div class="app">
	<main class="main">
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

{#if updateInfo}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="update-modal-backdrop"
		onclick={dismissUpdatePrompt}
		role="presentation"
	>
		<div
			class="update-modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby="update-modal-title"
			aria-describedby="update-modal-body"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			<button
				type="button"
				class="update-modal-close"
				onclick={dismissUpdatePrompt}
				aria-label="Close update notice"
			>
				×
			</button>
			<h2 id="update-modal-title" class="update-modal-title">Update available</h2>
			<p id="update-modal-body" class="update-modal-body">
				<strong>v{updateInfo.latestVersion}</strong> is out — you're currently on
				<strong>v{updateInfo.currentVersion}</strong>.
			</p>
			<div class="update-modal-actions">
				<button
					type="button"
					class="update-modal-btn update-modal-btn-secondary"
					onclick={dismissUpdatePrompt}
				>
					Not now
				</button>
				<a
					class="update-modal-btn update-modal-btn-primary"
					href={updateInfo.apkUrl}
					target="_blank"
					rel="noopener noreferrer"
					onclick={dismissUpdatePrompt}
				>
					Download
				</a>
			</div>
		</div>
	</div>
{/if}

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

	.update-modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		background: rgba(15, 23, 42, 0.45);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		animation: update-modal-backdrop-in 160ms ease-out;
	}

	.update-modal {
		position: relative;
		width: min(420px, 100%);
		max-height: calc(100dvh - 32px);
		overflow-y: auto;
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 22px 22px 18px;
		text-align: left;
		animation: update-modal-in 180ms ease-out;
	}

	.update-modal-close {
		position: absolute;
		top: 8px;
		right: 8px;
		width: 32px;
		height: 32px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 1.25rem;
		line-height: 1;
		background: transparent;
		border: 0;
		color: var(--muted);
		cursor: pointer;
		border-radius: 8px;
		transition: background 120ms ease, color 120ms ease;
	}

	.update-modal-close:hover {
		background: rgba(15, 23, 42, 0.06);
		color: var(--text);
	}

	.update-modal-title {
		margin: 0 28px 10px 0;
		font-size: 1.15rem;
		line-height: 1.25;
	}

	.update-modal-body {
		margin: 0 0 18px;
		font-size: 0.95rem;
		line-height: 1.45;
		color: var(--muted);
	}

	.update-modal-body strong {
		color: var(--text);
		font-weight: 600;
	}

	.update-modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		flex-wrap: wrap;
	}

	.update-modal-btn {
		font: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		padding: 8px 16px;
		border-radius: 10px;
		cursor: pointer;
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 36px;
		transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	.update-modal-btn-secondary {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--muted);
	}

	.update-modal-btn-secondary:hover {
		background: rgba(15, 23, 42, 0.05);
		color: var(--text);
		border-color: rgba(15, 23, 42, 0.22);
	}

	.update-modal-btn-primary {
		background: #0b3c8a;
		border: 1px solid #0b3c8a;
		color: #fff;
	}

	.update-modal-btn-primary:hover {
		background: #0a3478;
	}

	@keyframes update-modal-backdrop-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes update-modal-in {
		from { opacity: 0; transform: translateY(8px) scale(0.98); }
		to { opacity: 1; transform: translateY(0) scale(1); }
	}
</style>
