<script lang="ts">
    import { App } from "@capacitor/app";
    import { Geolocation } from "@capacitor/geolocation";
    import type { PluginListenerHandle } from "@capacitor/core";
    import { PUBLIC_API_KEY } from "$env/static/public";
    import { readForecastCache, writeForecastCache } from "$lib/weatherForecastCache";
    import { clearWeatherNotification, syncWeatherNotification } from "$lib/weatherNotification";
    import { onDestroy, onMount } from "svelte";

    function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
      const R = 6371000;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
    }

    type WeatherApiForecastHour = {
      time_epoch: number;
      temp_f: number;
      chance_of_rain: number;
      chance_of_snow: number;
      wind_mph: number;
      wind_dir: string;
    };

    type WeatherApiForecastDay = {
      date_epoch: number;
      day: {
        maxtemp_f: number;
        mintemp_f: number;
        daily_chance_of_rain: number;
        daily_chance_of_snow: number;
        maxwind_mph: number;
      };
      hour: WeatherApiForecastHour[];
    };

    type WeatherApiResponse = {
      location: {
        name: string;
        lat: number;
        lon: number;
      };
      current: {
        last_updated_epoch: number;
        temp_f: number;
        wind_mph: number;
        wind_dir: string;
        wind_degree: number;
      };
      forecast: {
        forecastday: WeatherApiForecastDay[];
      };
    };

    type WeatherApiCitySearchResult = {
      id: number;
      name: string;
      region: string;
      country: string;
      lat: number;
      lon: number;
      url: string;
    };

    type HourlyForecast = {
      timeEpoch: number;
      label: string;
      dateLabel: string;
      tempF: number;
      precipChancePct: number;
      windMph: number;
      windDir: string;
    };

    type DailyForecast = {
      dateEpoch: number;
      label: string;
      highF: number;
      lowF: number;
      precipChancePct: number;
      maxWindMph: number;
      maxWindDir: string;
    };

    function clampPct(n: unknown) {
      const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
      return Math.max(0, Math.min(100, Math.round(v)));
    }

    function precipChanceFromRainSnow(rainPct: unknown, snowPct: unknown) {
      return Math.max(clampPct(rainPct), clampPct(snowPct));
    }

    function formatHourLabel(timeEpochSeconds: number) {
      return new Date(timeEpochSeconds * 1000).toLocaleTimeString([], { hour: "numeric" });
    }

    function formatHourDateLabel(timeEpochSeconds: number) {
      return new Date(timeEpochSeconds * 1000).toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }

    function formatDayLabel(dateEpochSeconds: number) {
      return new Date(dateEpochSeconds * 1000).toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }

    async function fetchForecast(q: string) {
      const res = await fetch(
        `https://api.weatherapi.com/v1/forecast.json?key=${PUBLIC_API_KEY}&q=${encodeURIComponent(q)}&days=10&aqi=no&alerts=no`
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message || "API error");
      }
      return json as WeatherApiResponse;
    }

    async function fetchCitySuggestions(q: string) {
      const res = await fetch(
        `https://api.weatherapi.com/v1/search.json?key=${PUBLIC_API_KEY}&q=${encodeURIComponent(q)}`
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message || "API error");
      }
      return json as WeatherApiCitySearchResult[];
    }

    function hourlySlotsFromNow(allHours: WeatherApiForecastHour[], nowSec: number) {
      // Each API hour row covers [time_epoch, time_epoch + 1h); keep slots that still apply to now or the future.
      return allHours.filter((h) => h.time_epoch + 3600 > nowSec);
    }

    function buildHourlyAndDaily(resp: WeatherApiResponse) {
      const forecastDays = resp.forecast?.forecastday ?? [];
      const allHours = forecastDays.flatMap((d) => d.hour ?? []);
      const nowSec = Math.floor(Date.now() / 1000);
      const relevantHours = hourlySlotsFromNow(allHours, nowSec);
      const hoursForUi = relevantHours.length ? relevantHours : allHours;

      hourly = hoursForUi.slice(0, 72).map((h) => ({
        timeEpoch: h.time_epoch,
        label: formatHourLabel(h.time_epoch),
        dateLabel: formatHourDateLabel(h.time_epoch),
        tempF: h.temp_f,
        precipChancePct: precipChanceFromRainSnow(h.chance_of_rain, h.chance_of_snow),
        windMph: typeof h.wind_mph === "number" ? h.wind_mph : 0,
        windDir: typeof h.wind_dir === "string" ? h.wind_dir : "",
      }));

      daily = forecastDays.slice(0, 10).map((d) => {
        const hours = d.hour ?? [];
        let maxWindDir = "";
        let peakMph = -Infinity;
        for (const h of hours) {
          const mph = typeof h.wind_mph === "number" ? h.wind_mph : -Infinity;
          if (mph > peakMph) {
            peakMph = mph;
            maxWindDir = typeof h.wind_dir === "string" ? h.wind_dir : "";
          }
        }
        return {
          dateEpoch: d.date_epoch,
          label: formatDayLabel(d.date_epoch),
          highF: d.day.maxtemp_f,
          lowF: d.day.mintemp_f,
          precipChancePct: precipChanceFromRainSnow(d.day.daily_chance_of_rain, d.day.daily_chance_of_snow),
          maxWindMph: typeof d.day.maxwind_mph === "number" ? d.day.maxwind_mph : 0,
          maxWindDir,
        };
      });

      const currentEpoch = resp.current?.last_updated_epoch;
      if (typeof currentEpoch === "number" && hourly.length) {
        let best = hourly[0];
        let bestDist = Math.abs(best.timeEpoch - currentEpoch);
        for (const h of hourly) {
          const dist = Math.abs(h.timeEpoch - currentEpoch);
          if (dist < bestDist) {
            best = h;
            bestDist = dist;
          }
        }
        currentPrecipChancePct = best.precipChancePct;
      } else {
        currentPrecipChancePct = null;
      }
    }

    type TempUnit = "F" | "C";

    const TEMP_UNIT_STORAGE_KEY = "weather-app:tempUnit";

    function loadInitialTempUnit(): TempUnit {
      if (typeof localStorage === "undefined") return "F";
      const stored = localStorage.getItem(TEMP_UNIT_STORAGE_KEY);
      return stored === "C" ? "C" : "F";
    }

    function fToC(f: number) {
      return (f - 32) * (5 / 9);
    }

    function formatTemp(tempF: number, unit: TempUnit) {
      const value = unit === "C" ? fToC(tempF) : tempF;
      return `${Math.round(value)} °${unit}`;
    }

    function formatTempPrecise(tempF: number, unit: TempUnit) {
      const value = unit === "C" ? fToC(tempF) : tempF;
      return `${value.toFixed(1)} °${unit}`;
    }

    let city = $state("");
    let data: WeatherApiResponse | null = $state(null);
    let hourly: HourlyForecast[] = $state([]);
    let daily: DailyForecast[] = $state([]);
    let currentPrecipChancePct: number | null = $state(null);
    let loading = $state(false);
    let error = $state("");
    let tempUnit: TempUnit = $state(loadInitialTempUnit());

    $effect(() => {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(TEMP_UNIT_STORAGE_KEY, tempUnit);
    });
    let suggestions: WeatherApiCitySearchResult[] = $state([]);
    let suggestionsOpen = $state(false);
    let suggestionsLoading = $state(false);
    let suggestionsError = $state("");
    let highlightedSuggestionIdx: number = $state(-1);

    let suggestTimer: ReturnType<typeof setTimeout> | undefined;
    let lastSuggestQuery = "";
    let suppressSuggestOnce = false;

    let locationWatchId: string | undefined;
    let lastWatchLat: number | null = null;
    let lastWatchLon: number | null = null;
    let lastWatchFetchAt = 0;
    let appStateHandle: PluginListenerHandle | undefined;

    // Horizontal accuracy thresholds (meters). Anything worse than MAX is almost
    // certainly a Wi-Fi/cell/IP guess and will be ignored outright to avoid
    // showing weather for a random city.
    const TARGET_ACCURACY_M = 50;
    const ACCEPTABLE_ACCURACY_M = 200;
    const MAX_ACCURACY_M = 2000;

    type GeoPosition = Awaited<ReturnType<typeof Geolocation.getCurrentPosition>>;

    /**
     * Stream high-accuracy GPS fixes and return the most accurate one within a
     * deadline. Using watchPosition instead of a single getCurrentPosition call
     * lets us discard the first cold-start fix (which is often a wildly wrong
     * Wi-Fi / cell-tower guess) and wait for a real GPS lock.
     */
    async function getAccurateInitialPosition(): Promise<GeoPosition> {
      const INITIAL_WAIT_MS = 8_000; // after this, accept best-so-far if acceptable
      const MAX_WAIT_MS = 20_000; // overall deadline before giving up

      return await new Promise<GeoPosition>((resolve, reject) => {
        let best: GeoPosition | null = null;
        let watchId: string | undefined;
        let settled = false;
        let initialTimer: ReturnType<typeof setTimeout> | undefined;
        let overallTimer: ReturnType<typeof setTimeout> | undefined;

        const cleanup = () => {
          if (initialTimer) clearTimeout(initialTimer);
          if (overallTimer) clearTimeout(overallTimer);
          if (watchId) {
            const id = watchId;
            watchId = undefined;
            Geolocation.clearWatch({ id }).catch(() => {});
          }
        };

        const finish = (pos: GeoPosition) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(pos);
        };

        const fail = (err: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        };

        (async () => {
          try {
            watchId = await Geolocation.watchPosition(
              { enableHighAccuracy: true, maximumAge: 0, timeout: MAX_WAIT_MS },
              (position, err) => {
                if (err || !position) return;
                const acc = position.coords.accuracy;
                if (!Number.isFinite(acc) || acc > MAX_ACCURACY_M) return;
                if (!best || acc < best.coords.accuracy) best = position;
                if (acc <= TARGET_ACCURACY_M) finish(position);
              }
            );
          } catch {
            // Web fallback: watchPosition may be unavailable or rejected; try a
            // single high-accuracy read and still enforce the accuracy gate.
            try {
              const pos = await Geolocation.getCurrentPosition({
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: MAX_WAIT_MS,
              });
              if (
                Number.isFinite(pos.coords.accuracy) &&
                pos.coords.accuracy <= MAX_ACCURACY_M
              ) {
                finish(pos);
              } else {
                fail(new Error("Location accuracy too low"));
              }
            } catch (err2) {
              fail(err2);
            }
          }
        })();

        initialTimer = setTimeout(() => {
          if (best && best.coords.accuracy <= ACCEPTABLE_ACCURACY_M) finish(best);
        }, INITIAL_WAIT_MS);

        overallTimer = setTimeout(() => {
          if (best) finish(best);
          else fail(new Error("Timed out waiting for an accurate location"));
        }, MAX_WAIT_MS);
      });
    }

    async function stopGpsWatch() {
      if (!locationWatchId) return;
      const id = locationWatchId;
      locationWatchId = undefined;
      try {
        await Geolocation.clearWatch({ id });
      } catch {
        /* clearWatch may be unavailable on web */
      }
      lastWatchLat = null;
      lastWatchLon = null;
    }

    async function startGpsWatch(initialLat: number, initialLon: number) {
      await stopGpsWatch();
      lastWatchLat = initialLat;
      lastWatchLon = initialLon;
      lastWatchFetchAt = Date.now();

      try {
        locationWatchId = await Geolocation.watchPosition(
          {
            enableHighAccuracy: true,
            timeout: 25000,
            maximumAge: 10000,
            interval: 30000,
            minimumUpdateInterval: 25000,
          },
          async (position, err) => {
            if (err || !position) return;
            // Ignore coarse / network-only fixes — a single bad reading here
            // would otherwise re-fetch weather for a totally wrong city.
            const acc = position.coords.accuracy;
            if (!Number.isFinite(acc) || acc > MAX_ACCURACY_M) return;
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            if (lastWatchLat === null || lastWatchLon === null) {
              lastWatchLat = lat;
              lastWatchLon = lon;
              return;
            }
            const movedM = haversineMeters(lastWatchLat, lastWatchLon, lat, lon);
            const now = Date.now();
            // Require movement to clearly exceed reported uncertainty so GPS
            // jitter around a stationary user doesn't trigger a refetch.
            if (movedM < Math.max(900, acc * 2)) return;
            if (now - lastWatchFetchAt < 50000) return;

            lastWatchFetchAt = now;
            lastWatchLat = lat;
            lastWatchLon = lon;

            try {
              const q = `${lat},${lon}`;
              const resp = await fetchForecast(q);
              writeForecastCache(q, resp);
              suppressSuggestOnce = true;
              city = resp.location.name;
              applyForecastResponse(resp);
            } catch (e) {
              console.error(e);
            }
          }
        );
      } catch (e) {
        console.error(e);
      }
    }

    onDestroy(() => {
      if (suggestTimer) clearTimeout(suggestTimer);
      void stopGpsWatch();
      if (appStateHandle) {
        void appStateHandle.remove();
        appStateHandle = undefined;
      }
    });

    onMount(() => {
      void loadWeatherOnOpenOrResume();
      void (async () => {
        try {
          appStateHandle = await App.addListener("appStateChange", (state) => {
            if (state.isActive) void loadWeatherOnOpenOrResume();
          });
        } catch {
          // App plugin not available on web.
        }
      })();
    });

    let locationPending = $state(false);

    function applyForecastResponse(resp: WeatherApiResponse, opts?: { notify?: boolean }) {
      data = resp;
      buildHourlyAndDaily(resp);
      const notify = opts?.notify ?? true;
      if (notify) {
        void syncWeatherNotification(resp, currentPrecipChancePct);
      }
    }

    async function ensureLocationPermission(): Promise<boolean> {
      try {
        const checked = await Geolocation.checkPermissions();
        if (checked.location !== "granted") {
          try {
            const requested = await Geolocation.requestPermissions();
            if (requested.location !== "granted") {
              error = "Location permission denied. Enter a city to get weather.";
              return false;
            }
          } catch {
            // Web: requestPermissions is unimplemented; getCurrentPosition will trigger the browser prompt.
          }
        }
      } catch {
        // checkPermissions unavailable in this environment — still try the position read.
      }
      return true;
    }

    /** Geolocate + forecast + optional notification sync (used after cache paint and for “My location”). */
    async function fetchForecastFromCurrentPosition(notify: boolean): Promise<boolean> {
      await stopGpsWatch();
      await clearWeatherNotification();
      if (!(await ensureLocationPermission())) return false;
      const pos = await getAccurateInitialPosition();
      const { latitude, longitude } = pos.coords;
      const q = `${latitude},${longitude}`;
      const resp = await fetchForecast(q);
      writeForecastCache(q, resp);
      suppressSuggestOnce = true;
      city = resp.location.name;
      applyForecastResponse(resp, { notify });
      await startGpsWatch(latitude, longitude);
      return true;
    }

    /** Open / resume: paint last cached forecast immediately, then refresh from current GPS in the background. */
    async function loadWeatherOnOpenOrResume() {
      error = "";
      const cached = readForecastCache<WeatherApiResponse>();
      if (cached) {
        suppressSuggestOnce = true;
        city = cached.response.location.name;
        applyForecastResponse(cached.response, { notify: false });
        locationPending = false;
        loading = false;
        void startGpsWatch(cached.response.location.lat, cached.response.location.lon);
        void (async () => {
          loading = true;
          locationPending = true;
          try {
            await fetchForecastFromCurrentPosition(true);
          } catch (e) {
            console.error(e);
          } finally {
            loading = false;
            locationPending = false;
          }
        })();
        return;
      }

      loading = true;
      locationPending = true;
      data = null;
      hourly = [];
      daily = [];
      currentPrecipChancePct = null;
      try {
        const ok = await fetchForecastFromCurrentPosition(true);
        if (!ok) await stopGpsWatch();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        error =
          msg ||
          "Could not get your location. Enter a city and tap Get weather.";
        console.error(e);
        await stopGpsWatch();
      } finally {
        locationPending = false;
        loading = false;
      }
    }

    /** “My location” button: always bypass UI cache and fetch from current GPS + API. */
    async function loadWeatherFromCurrentLocation() {
      error = "";
      loading = true;
      locationPending = true;
      data = null;
      hourly = [];
      daily = [];
      currentPrecipChancePct = null;
      try {
        const ok = await fetchForecastFromCurrentPosition(true);
        if (!ok) await stopGpsWatch();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        error =
          msg ||
          "Could not get your location. Enter a city and tap Get weather.";
        console.error(e);
        await stopGpsWatch();
      } finally {
        locationPending = false;
        loading = false;
      }
    }

    $effect(() => {
      const q = city.trim();
      suggestionsError = "";

      if (suggestTimer) clearTimeout(suggestTimer);

      if (suppressSuggestOnce) {
        suppressSuggestOnce = false;
        return;
      }

      if (q.length < 2) {
        suggestions = [];
        suggestionsOpen = false;
        highlightedSuggestionIdx = -1;
        lastSuggestQuery = q;
        return;
      }

      suggestTimer = setTimeout(async () => {
        if (q === lastSuggestQuery) return;
        lastSuggestQuery = q;
        suggestionsLoading = true;
        highlightedSuggestionIdx = -1;
        try {
          const results = await fetchCitySuggestions(q);
          // Keep more results and rely on dropdown max-height + scrolling.
          suggestions = results.slice(0, 20);
          suggestionsOpen = suggestions.length > 0;
        } catch (e: any) {
          suggestions = [];
          suggestionsOpen = false;
          suggestionsError = e?.message || "Failed to load suggestions";
        } finally {
          suggestionsLoading = false;
        }
      }, 250);
    });

    function applySuggestion(s: WeatherApiCitySearchResult) {
      suppressSuggestOnce = true;
      city = `${s.name}, ${s.region ? `${s.region}, ` : ""}${s.country}`.replace(", ,", ",").trim();
      suggestions = [];
      suggestionsOpen = false;
      highlightedSuggestionIdx = -1;
      void fetchWeather();
    }

    function onCityKeyDown(e: KeyboardEvent) {
      if (!suggestionsOpen || !suggestions.length) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        highlightedSuggestionIdx = Math.min(suggestions.length - 1, highlightedSuggestionIdx + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        highlightedSuggestionIdx = Math.max(0, highlightedSuggestionIdx - 1);
      } else if (e.key === "Enter") {
        if (highlightedSuggestionIdx >= 0 && highlightedSuggestionIdx < suggestions.length) {
          e.preventDefault();
          applySuggestion(suggestions[highlightedSuggestionIdx]);
        }
      } else if (e.key === "Escape") {
        suggestionsOpen = false;
        highlightedSuggestionIdx = -1;
      }
    }

    async function fetchWeather() {
      error = "";
      const q = city.trim();
      if (!q) {
        error = "Enter a city or use My location.";
        return;
      }

      loading = true;
      data = null;
      hourly = [];
      daily = [];
      currentPrecipChancePct = null;

      try {
        await stopGpsWatch();
        const resp = await fetchForecast(q);
        writeForecastCache(q, resp);
        applyForecastResponse(resp);
      } catch (e: unknown) {
        error = e instanceof Error ? e.message : "Request failed";
        console.error(e);
      } finally {
        loading = false;
      }
    }
</script>

<div class="page">
  <h1>Weather App</h1>

  <div class="search">
    <input
      placeholder="City (default: your location)"
      bind:value={city}
      onkeydown={onCityKeyDown}
      onfocus={() => (suggestionsOpen = suggestions.length > 0)}
      onblur={() => setTimeout(() => (suggestionsOpen = false), 120)}
      autocomplete="off"
      aria-autocomplete="list"
      aria-expanded={suggestionsOpen}
      aria-controls="city-suggestions"
    />

    {#if suggestionsLoading}
      <div class="suggest-hint">Searching…</div>
    {:else if suggestionsError}
      <div class="suggest-hint error">{suggestionsError}</div>
    {/if}

    {#if suggestionsOpen}
      <div id="city-suggestions" class="suggestions" role="listbox">
        {#each suggestions as s, idx (s.id)}
          <button
            type="button"
            class="suggestion {idx === highlightedSuggestionIdx ? 'active' : ''}"
            role="option"
            aria-selected={idx === highlightedSuggestionIdx}
            onclick={() => applySuggestion(s)}
          >
            <div class="suggestion-name">{s.name}</div>
            <div class="suggestion-meta">{s.region ? `${s.region} • ` : ""}{s.country}</div>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="actions">
    <button type="button" onclick={fetchWeather} disabled={loading}>Get weather</button>
    <button type="button" onclick={() => loadWeatherFromCurrentLocation()} disabled={loading}>My location</button>
    <label class="unit-select">
      <span class="unit-label">Units</span>
      <select bind:value={tempUnit} aria-label="Temperature units">
        <option value="F">Fahrenheit (°F)</option>
        <option value="C">Celsius (°C)</option>
      </select>
    </label>
  </div>

  {#if error}
    <p style="color:red">{error}</p>
  {/if}

  {#if data}
    <div class="card">
      <h2>{data.location.name}</h2>
      <p>🌡️ {formatTempPrecise(data.current.temp_f, tempUnit)}</p>
      <p>💨 {data.current.wind_mph.toFixed(1)} mph {data.current.wind_dir} ({Math.round(data.current.wind_degree)}°)</p>
      <p>☔ {currentPrecipChancePct ?? 0}% precip</p>
    </div>
  {/if}

  {#if hourly.length}
    <section class="forecast">
      <h3>Next 72 hours</h3>
      <div class="hourly-grid">
        {#each hourly as h}
          <div class="hourly-item">
            <div class="hourly-time">
              {h.label}
            </div>
            <div class="hourly-date">
              {h.dateLabel}
            </div>
            <div class="hourly-temp">
              {formatTemp(h.tempF, tempUnit)}
            </div>
            <div class="hourly-pop">
              {h.precipChancePct}% precip
            </div>
            <div class="hourly-wind">
              {h.windMph.toFixed(1)} mph{h.windDir ? ` ${h.windDir}` : ""}
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if daily.length}
    <section class="forecast">
      <h3>Next 3 days</h3>
      <div class="daily-list">
        {#each daily as d}
          <div class="daily-item">
            <div class="daily-date">
              {d.label}
            </div>
            <div class="daily-temps">
              <span>High {formatTemp(d.highF, tempUnit)}</span>
              <span>Low {formatTemp(d.lowF, tempUnit)}</span>
            </div>
            <div class="daily-meta">
              <span>{d.precipChancePct}% precip</span>
              <span>{d.maxWindMph.toFixed(1)} mph{d.maxWindDir ? ` ${d.maxWindDir}` : ""}</span>
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .page {
    padding: clamp(1rem, 3vw, 2rem);
    font-family: sans-serif;
    text-align: center;
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    /* Keep content full-width so horizontal scrollers can overflow. */
    align-items: stretch;
  }

  .search {
    width: 100%;
    max-width: 520px;
    margin: 0.5rem 0 0;
    position: relative;
    text-align: left;
  }

  input {
    padding: 0.5rem;
    width: 100%;
    box-sizing: border-box;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    margin: 0.75rem 0 0.25rem;
    flex-wrap: wrap;
  }

  button {
    padding: 0.5rem 1rem;
  }

  .unit-select {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
  }

  .unit-label {
    opacity: 0.75;
  }

  .unit-select select {
    padding: 0.4rem 0.5rem;
    border-radius: 6px;
    border: 1px solid #ccc;
    background: white;
    font-size: 0.9rem;
  }

  .suggest-hint {
    margin-top: 0.25rem;
    font-size: 0.85rem;
    opacity: 0.75;
  }

  .suggest-hint.error {
    opacity: 1;
    color: #b00020;
  }

  .suggestions {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    background: white;
    border: 1px solid #e6e6e6;
    border-radius: 10px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.12);
    max-height: min(320px, 45vh);
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    z-index: 10;
  }

  .forecast {
    width: 100%;
  }

  .suggestion {
    width: 100%;
    text-align: left;
    border: 0;
    background: transparent;
    padding: 0.6rem 0.75rem;
    cursor: pointer;
  }

  .suggestion:hover,
  .suggestion.active {
    background: #f3f3f3;
  }

  .suggestion-name {
    font-weight: 600;
  }

  .suggestion-meta {
    font-size: 0.85rem;
    opacity: 0.75;
    margin-top: 0.05rem;
  }

  .card {
    margin-top: 1rem;
    padding: 1rem;
    border-radius: 12px;
    background: #f3f3f3;
  }

  .forecast {
    margin-top: 2rem;
    text-align: left;
  }

  .forecast h3 {
    margin-bottom: 0.5rem;
  }

  .hourly-grid {
    display: flex;
    overflow-x: auto;
    gap: 0.75rem;
    padding-bottom: 0.5rem;
  }

  .hourly-item {
    min-width: 88px;
    padding: 0.45rem 0.4rem;
    border-radius: 8px;
    background: #f8f8f8;
    font-size: 0.75rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    white-space: nowrap;
  }

  .hourly-time {
    font-weight: bold;
    margin-bottom: 0;
  }

  .hourly-date {
    font-size: 0.65rem;
    opacity: 0.7;
    line-height: 1.1;
  }

  .hourly-pop {
    margin-top: 0.1rem;
    font-size: 0.7rem;
  }

  .hourly-wind {
    font-size: 0.7rem;
    opacity: 0.8;
  }

  .daily-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .daily-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    background: #f8f8f8;
    font-size: 0.9rem;
  }

  .daily-date {
    flex: 1;
    text-align: left;
  }

  .daily-temps {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex: 1;
    align-items: center;
    text-align: center;
  }

  .daily-meta {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex: 1;
    align-items: flex-end;
    text-align: right;
  }
</style>