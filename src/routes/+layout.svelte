<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<div class="app">
	<main class="main">
		{@render children()}
	</main>
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

	@media (prefers-color-scheme: dark) {
		:global(:root) {
			--bg: #070b18;
			--surface: rgba(255, 255, 255, 0.06);
			--border: rgba(255, 255, 255, 0.12);
			--text: rgba(255, 255, 255, 0.92);
			--muted: rgba(255, 255, 255, 0.66);
			--shadow: 0 18px 60px rgba(0, 0, 0, 0.45);
		}
	}

	:global(html, body) {
		height: 100%;
	}

	:global(body) {
		margin: 0;
		color: var(--text);
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

	@media (prefers-color-scheme: dark) {
		:global(body)::before,
		:global(body)::after {
			background:
				radial-gradient(42vmax 30vmax at 20% 15%, rgba(93, 160, 255, 0.22), transparent 68%),
				radial-gradient(46vmax 32vmax at 85% 25%, rgba(0, 255, 209, 0.12), transparent 70%),
				radial-gradient(56vmax 42vmax at 55% 85%, rgba(255, 155, 80, 0.08), transparent 72%);
		}
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
		overflow: hidden;
	}

	@media (min-width: 720px) {
		.main {
			padding: 18px;
		}
	}
</style>
