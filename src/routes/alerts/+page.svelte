<script lang="ts">
  import { browser } from "$app/environment";
  import { page } from "$app/state";
  import { readForecastCache } from "$lib/weatherForecastCache";
  import {
    getAlerts,
    weatherAlertDedupKey,
    type WeatherApiAlert,
    type WeatherApiResponse,
  } from "$lib/forecast";
  import { onMount } from "svelte";

  let locationName = $state("");
  let alerts: WeatherApiAlert[] = $state([]);
  let loaded = $state(false);

  let highlightedKey = $derived(page.url.searchParams.get("alert") ?? "");

  function formatRange(effective?: string, expires?: string) {
    const fmt = (s?: string) => {
      if (!s) return "";
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return s;
      return d.toLocaleString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    };
    const a = fmt(effective);
    const b = fmt(expires);
    if (a && b) return `${a} → ${b}`;
    return a || b || "";
  }

  function severityClass(severity?: string) {
    const s = (severity || "").toLowerCase();
    if (s.includes("extreme")) return "severity-extreme";
    if (s.includes("severe")) return "severity-severe";
    if (s.includes("moderate")) return "severity-moderate";
    if (s.includes("minor")) return "severity-minor";
    return "severity-unknown";
  }

  onMount(() => {
    const cached = readForecastCache<WeatherApiResponse>();
    if (cached) {
      locationName = cached.response.location?.name ?? "";
      alerts = getAlerts(cached.response);
    }
    loaded = true;
  });

  $effect(() => {
    if (!browser || !loaded || !highlightedKey) return;
    const key = highlightedKey;
    queueMicrotask(() => {
      const esc =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(key)
          : key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const el = document.querySelector(`[data-alert-key="${esc}"]`);
      if (!(el instanceof HTMLElement)) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.querySelectorAll("details").forEach((d) => {
        (d as HTMLDetailsElement).open = true;
      });
    });
  });
</script>

<div class="page">
  <header class="page-header">
    <a class="back-link" href="/" aria-label="Back to home">← Back</a>
    <div class="page-header-intro">
      <h1>Weather alerts</h1>
      {#if locationName}
        <p class="location">
          {locationName}
          {#if loaded}· {alerts.length} active{/if}
        </p>
      {/if}
    </div>
  </header>

  {#if !loaded}
    <p class="empty">Loading…</p>
  {:else if !alerts.length}
    <div class="empty-card">
      <div class="empty-icon" aria-hidden="true">✅</div>
      <h2>No active alerts</h2>
      <p>There are no weather alerts for this area right now.</p>
    </div>
  {:else}
    <ul class="alert-list">
      {#each alerts as a, idx (weatherAlertDedupKey(a))}
        <li
          class="alert-card {severityClass(a.severity)}"
          class:highlight={weatherAlertDedupKey(a) === highlightedKey}
          data-alert-key={weatherAlertDedupKey(a)}
        >
          <div class="alert-head">
            <span class="event">{a.event || a.headline || "Weather alert"}</span>
            {#if a.severity}
              <span class="badge">{a.severity}</span>
            {/if}
          </div>

          {#if a.headline && a.headline !== a.event}
            <div class="headline">{a.headline}</div>
          {/if}

          {#if a.areas}
            <div class="meta"><strong>Areas:</strong> {a.areas}</div>
          {/if}

          {#if a.effective || a.expires}
            <div class="meta"><strong>When:</strong> {formatRange(a.effective, a.expires)}</div>
          {/if}

          {#if a.urgency || a.certainty || a.category}
            <div class="meta tags">
              {#if a.category}<span class="tag">{a.category}</span>{/if}
              {#if a.urgency}<span class="tag">Urgency: {a.urgency}</span>{/if}
              {#if a.certainty}<span class="tag">Certainty: {a.certainty}</span>{/if}
            </div>
          {/if}

          {#if a.desc}
            <details class="details">
              <summary>Details</summary>
              <p class="desc">{a.desc}</p>
            </details>
          {/if}

          {#if a.instruction}
            <details class="details">
              <summary>Instructions</summary>
              <p class="desc">{a.instruction}</p>
            </details>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .page {
    padding: clamp(0.75rem, 2vw, 1.25rem);
    font-family: sans-serif;
    max-width: 720px;
    margin: 0 auto;
    font-size: clamp(0.95rem, 0.85rem + 0.6vw, 1.1rem);
    line-height: 1.4;
  }

  .page-header {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.65rem;
  }

  .page-header-intro {
    text-align: center;
  }

  .page-header h1 {
    margin: 0;
    font-size: clamp(1.2rem, 1rem + 1.2vw, 1.6rem);
  }

  .back-link {
    align-self: flex-start;
    text-decoration: none;
    color: inherit;
    padding: 0.35rem 0.6rem;
    border-radius: 8px;
    background: #f3f3f3;
    border: 1px solid rgba(15, 23, 42, 0.1);
    font-size: 0.9rem;
  }

  .back-link:hover {
    background: #ececec;
  }

  .location {
    margin: 0.35rem 0 0.75rem;
    opacity: 0.75;
    font-size: 0.95rem;
  }

  .empty {
    text-align: center;
    opacity: 0.7;
  }

  .empty-card {
    margin-top: 1.5rem;
    padding: 1.5rem 1rem;
    border-radius: 12px;
    background: #f3f3f3;
    text-align: center;
  }

  .empty-card h2 {
    margin: 0.25rem 0;
    font-size: 1.15rem;
  }

  .empty-card p {
    margin: 0.25rem 0 0.75rem;
    opacity: 0.75;
  }

  .empty-icon {
    font-size: 2rem;
  }

  .alert-list {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .alert-card {
    padding: 0.85rem 1rem;
    border-radius: 12px;
    border: 1px solid;
    background: #fff;
  }

  .alert-card.highlight {
    outline: 3px solid rgba(37, 99, 235, 0.55);
    outline-offset: 3px;
  }

  .severity-extreme {
    background: #fde2e2;
    border-color: #f17878;
    color: #5b0a0a;
  }
  .severity-severe {
    background: #ffe4cc;
    border-color: #f59149;
    color: #5a2a00;
  }
  .severity-moderate {
    background: #fff4cc;
    border-color: #e0b53b;
    color: #5b3f00;
  }
  .severity-minor {
    background: #e8f3ff;
    border-color: #79a8e6;
    color: #1d3a72;
  }
  .severity-unknown {
    background: #f3f3f3;
    border-color: rgba(15, 23, 42, 0.12);
    color: inherit;
  }

  .alert-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .event {
    font-weight: 700;
    font-size: clamp(1rem, 0.92rem + 0.4vw, 1.15rem);
  }

  .badge {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.08);
    font-weight: 600;
    white-space: nowrap;
  }

  .headline {
    font-size: 0.95rem;
    margin-bottom: 0.4rem;
  }

  .meta {
    font-size: 0.88rem;
    margin: 0.15rem 0;
    opacity: 0.9;
  }

  .meta strong {
    opacity: 0.8;
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .tag {
    background: rgba(0, 0, 0, 0.06);
    border-radius: 999px;
    padding: 0.1rem 0.55rem;
    font-size: 0.78rem;
  }

  .details {
    margin-top: 0.5rem;
  }

  .details summary {
    cursor: pointer;
    font-weight: 600;
    padding: 0.25rem 0;
  }

  .desc {
    margin: 0.25rem 0 0;
    white-space: pre-wrap;
    font-size: 0.92rem;
    line-height: 1.5;
  }
</style>
