<script lang="ts">
  import { readForecastCache } from "$lib/weatherForecastCache";
  import {
    buildHourly,
    formatTemp,
    loadInitialTempUnit,
    type HourlyForecast,
    type TempUnit,
    type WeatherApiResponse,
  } from "$lib/forecast";
  import { onMount } from "svelte";

  let locationName = $state("");
  let hourly: HourlyForecast[] = $state([]);
  let tempUnit: TempUnit = $state(loadInitialTempUnit());
  let loaded = $state(false);

  onMount(() => {
    const cached = readForecastCache<WeatherApiResponse>();
    if (cached) {
      locationName = cached.response.location?.name ?? "";
      hourly = buildHourly(cached.response, 72);
    }
    loaded = true;
  });

  // Group hours by date label so the page feels less like a giant flat list.
  let groups = $derived.by(() => {
    const out: { dateLabel: string; items: HourlyForecast[] }[] = [];
    for (const h of hourly) {
      const last = out[out.length - 1];
      if (last && last.dateLabel === h.dateLabel) {
        last.items.push(h);
      } else {
        out.push({ dateLabel: h.dateLabel, items: [h] });
      }
    }
    return out;
  });
</script>

<div class="page">
  <header class="page-header">
    <a class="back-link" href="/" aria-label="Back to home">← Back</a>
    <div class="page-header-intro">
      <h1>Hourly forecast</h1>
      {#if locationName}
        <p class="location">{locationName} · next 72 hours</p>
      {/if}
    </div>
  </header>

  {#if !loaded}
    <p class="empty">Loading…</p>
  {:else if !hourly.length}
    <div class="empty-card">
      <p>No forecast loaded yet.</p>
      <a class="primary" href="/">Go back to load the weather</a>
    </div>
  {:else}
    {#each groups as group (group.dateLabel)}
      <section class="day-group">
        <h2>{group.dateLabel}</h2>
        <ul class="hour-list">
          {#each group.items as h (h.timeEpoch)}
            <li class="hour-row">
              <span class="hour-time">{h.label}</span>
              <span class="hour-temp">{formatTemp(h.tempF, tempUnit)}</span>
              <div class="hour-meta">
                <span class="hour-pop" aria-label="Chance of precipitation">
                  <span class="meta-icon" aria-hidden="true">☔</span>
                  <span class="meta-value">{h.precipChancePct}%</span>
                </span>
                <span class="hour-wind" aria-label="Wind">
                  <span class="meta-icon" aria-hidden="true">💨</span>
                  <span class="meta-value">
                    {h.windMph.toFixed(1)} mph{h.windDir ? ` ${h.windDir}` : ""}
                  </span>
                </span>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
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

  .day-group {
    margin-top: 1rem;
  }

  .day-group h2 {
    margin: 0 0 0.4rem;
    font-size: clamp(1rem, 0.9rem + 0.4vw, 1.15rem);
    border-bottom: 1px solid rgba(15, 23, 42, 0.1);
    padding-bottom: 0.25rem;
  }

  .hour-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .hour-row {
    display: grid;
    grid-template-columns: 4.5rem 4.5rem 1fr;
    align-items: center;
    gap: 0.4rem 0.75rem;
    padding: 0.6rem 0.85rem;
    border-radius: 10px;
    background: #f8f8f8;
    font-size: clamp(0.88rem, 0.82rem + 0.3vw, 0.98rem);
  }

  .hour-time {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .hour-temp {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .hour-meta {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 0.35rem 0.85rem;
    font-size: 0.88em;
    opacity: 0.85;
  }

  .hour-pop,
  .hour-wind {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .meta-icon {
    font-size: 0.9em;
  }

  @media (max-width: 460px) {
    .hour-row {
      grid-template-columns: 4rem 1fr;
      gap: 0.25rem 0.6rem;
      padding: 0.55rem 0.7rem;
    }
    .hour-temp {
      text-align: right;
    }
    .hour-meta {
      grid-column: 1 / -1;
      justify-content: space-between;
      gap: 0.25rem 0.75rem;
    }
  }
</style>
