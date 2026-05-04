<script lang="ts">
  import { readForecastCache } from "$lib/weatherForecastCache";
  import {
    buildDaily,
    formatTemp,
    loadInitialTempUnit,
    type DailyForecast,
    type TempUnit,
    type WeatherApiResponse,
  } from "$lib/forecast";
  import { onMount } from "svelte";

  let locationName = $state("");
  let daily: DailyForecast[] = $state([]);
  let tempUnit: TempUnit = $state(loadInitialTempUnit());
  let loaded = $state(false);

  onMount(() => {
    const cached = readForecastCache<WeatherApiResponse>();
    if (cached) {
      locationName = cached.response.location?.name ?? "";
      daily = buildDaily(cached.response, 10);
    }
    loaded = true;
  });
</script>

<div class="page">
  <header class="page-header">
    <a class="back-link" href="/" aria-label="Back to home">← Back</a>
    <div class="page-header-intro">
      <h1>Daily forecast</h1>
      {#if locationName}
        <p class="location">{locationName} · next {daily.length || 10} days</p>
      {/if}
    </div>
  </header>

  {#if !loaded}
    <p class="empty">Loading…</p>
  {:else if !daily.length}
    <div class="empty-card">
      <p>No forecast loaded yet.</p>
      <a class="primary" href="/">Go back to load the weather</a>
    </div>
  {:else}
    <ul class="daily-list">
      {#each daily as d (d.dateEpoch)}
        <li class="daily-item">
          <div class="daily-date">{d.label}</div>
          <div class="daily-temps">
            <span class="hi">High {formatTemp(d.highF, tempUnit)}</span>
            <span class="lo">Low {formatTemp(d.lowF, tempUnit)}</span>
          </div>
          <div class="daily-meta">
            <span>☔ {d.precipChancePct}% precip</span>
            <span>💨 {d.maxWindMph.toFixed(1)} mph{d.maxWindDir ? ` ${d.maxWindDir}` : ""}</span>
          </div>
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
    padding: 1rem;
    border-radius: 12px;
    background: #f3f3f3;
    text-align: center;
  }

  .empty-card .primary {
    display: inline-block;
    margin-top: 0.5rem;
    padding: 0.45rem 0.9rem;
    background: #2563eb;
    color: white;
    border-radius: 8px;
    text-decoration: none;
    font-weight: 600;
  }

  .daily-list {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .daily-item {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 0.4rem 1rem;
    padding: 0.7rem 0.85rem;
    border-radius: 10px;
    background: #f8f8f8;
    font-size: clamp(0.88rem, 0.82rem + 0.3vw, 1rem);
  }

  .daily-date {
    font-weight: 600;
  }

  .daily-temps {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .daily-temps .hi {
    font-weight: 600;
  }

  .daily-temps .lo {
    opacity: 0.75;
    font-size: 0.92em;
  }

  .daily-meta {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    text-align: right;
    font-size: 0.9em;
    opacity: 0.85;
  }

  @media (max-width: 480px) {
    .daily-item {
      grid-template-columns: 1fr auto;
      grid-template-rows: auto auto;
    }
    .daily-meta {
      grid-column: 1 / -1;
      flex-direction: row;
      justify-content: space-between;
      text-align: left;
    }
  }
</style>
