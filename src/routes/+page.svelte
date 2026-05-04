<script lang="ts">
    import { Geolocation } from "@capacitor/geolocation";
    import { PUBLIC_API_KEY } from "$env/static/public";
    import { readForecastCache, writeForecastCache } from "$lib/weatherForecastCache";
    import { clearWeatherNotification, syncWeatherNotification } from "$lib/weatherNotification";
    import { clearNotifiedAlerts, syncAlertNotifications } from "$lib/weatherAlertNotifications";
    import {
      buildDaily,
      buildHourly,
      currentPrecipChanceFromHourly,
      formatTempPrecise,
      getAlerts,
      loadInitialTempUnit,
      TEMP_UNIT_STORAGE_KEY,
      type DailyForecast,
      type HourlyForecast,
      type TempUnit,
      type WeatherApiResponse,
    } from "$lib/forecast";
    import {
      isBootstrapped,
      markBootstrapped,
      registerHomeRefresh,
      unregisterHomeRefresh,
    } from "$lib/sessionState";
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

    type WeatherApiCitySearchResult = {
      id: number;
      name: string;
      region: string;
      country: string;
      lat: number;
      lon: number;
      url: string;
    };

    async function fetchForecast(q: string) {
      const res = await fetch(
        `https://api.weatherapi.com/v1/forecast.json?key=${PUBLIC_API_KEY}&q=${encodeURIComponent(q)}&days=10&aqi=no&alerts=yes`
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

    function buildHourlyAndDaily(resp: WeatherApiResponse) {
      hourly = buildHourly(resp);
      daily = buildDaily(resp);
      currentPrecipChancePct = currentPrecipChanceFromHourly(
        hourly,
        resp.current?.last_updated_epoch
      );
    }

    let city = $state("");
    let data: WeatherApiResponse | null = $state(null);
    let hourly: HourlyForecast[] = $state([]);
    let daily: DailyForecast[] = $state([]);
    let currentPrecipChancePct: number | null = $state(null);
    let loading = $state(false);
    let error = $state("");
    let tempUnit: TempUnit = $state(loadInitialTempUnit());

    let alertCount = $derived(getAlerts(data).length);

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

    // Horizontal accuracy thresholds (meters). Precise mode rejects very coarse
    // fixes to avoid weather for a random tower/IP centroid. Approximate mode
    // (Android “approximate only”, or web coarse permission) allows larger radii.
    const PRECISE_TARGET_M = 50;
    const PRECISE_ACCEPTABLE_M = 200;
    const PRECISE_MAX_M = 2000;

    const APPROX_TARGET_M = 10_000;
    const APPROX_ACCEPTABLE_M = 25_000;
    const APPROX_MAX_M = 150_000;

    type GeoPosition = Awaited<ReturnType<typeof Geolocation.getCurrentPosition>>;

    type PositionStrategy = {
      enableHighAccuracy: boolean;
      targetM: number;
      acceptableM: number;
      maxM: number;
      initialWaitMs: number;
      maxWaitMs: number;
    };

    function strategyForApproximateMode(approximate: boolean): PositionStrategy {
      if (approximate) {
        return {
          enableHighAccuracy: false,
          targetM: APPROX_TARGET_M,
          acceptableM: APPROX_ACCEPTABLE_M,
          maxM: APPROX_MAX_M,
          initialWaitMs: 5_000,
          maxWaitMs: 15_000,
        };
      }
      return {
        enableHighAccuracy: true,
        targetM: PRECISE_TARGET_M,
        acceptableM: PRECISE_ACCEPTABLE_M,
        maxM: PRECISE_MAX_M,
        initialWaitMs: 8_000,
        maxWaitMs: 20_000,
      };
    }

    /** Android 12+: coarse granted but fine denied — user chose approximate location only. */
    async function isApproximateLocationOnly(): Promise<boolean> {
      try {
        const p = await Geolocation.checkPermissions();
        return p.coarseLocation === "granted" && p.location !== "granted";
      } catch {
        return false;
      }
    }

    /**
     * Stream fixes and return the best within deadlines. Uses watchPosition when
     * available so cold-start network guesses can be skipped in precise mode.
     */
    async function getInitialPositionWithStrategy(approximate: boolean): Promise<GeoPosition> {
      const s = strategyForApproximateMode(approximate);

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
              { enableHighAccuracy: s.enableHighAccuracy, maximumAge: 0, timeout: s.maxWaitMs },
              (position, err) => {
                if (err || !position) return;
                const acc = position.coords.accuracy;
                if (!Number.isFinite(acc) || acc > s.maxM) return;
                if (!best || acc < best.coords.accuracy) best = position;
                if (acc <= s.targetM) finish(position);
              }
            );
          } catch {
            try {
              const pos = await Geolocation.getCurrentPosition({
                enableHighAccuracy: s.enableHighAccuracy,
                maximumAge: 0,
                timeout: s.maxWaitMs,
              });
              if (
                Number.isFinite(pos.coords.accuracy) &&
                pos.coords.accuracy <= s.maxM
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
          if (best && best.coords.accuracy <= s.acceptableM) finish(best);
        }, s.initialWaitMs);

        overallTimer = setTimeout(() => {
          if (best) finish(best);
          else fail(new Error("Timed out waiting for an accurate location"));
        }, s.maxWaitMs);
      });
    }

    /**
     * Prefer precise fixes when fine location is allowed; otherwise use coarse
     * thresholds. On web, coarse permission cannot be told apart from precise via
     * Capacitor — if the precise pass yields nothing under PRECISE_MAX_M, retry
     * with approximate strategy once.
     */
    async function getAccurateInitialPosition(): Promise<GeoPosition> {
      const approxOnly = await isApproximateLocationOnly();
      if (approxOnly) {
        return await getInitialPositionWithStrategy(true);
      }
      try {
        return await getInitialPositionWithStrategy(false);
      } catch {
        return await getInitialPositionWithStrategy(true);
      }
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

      const approxOnly = await isApproximateLocationOnly();
      const s = strategyForApproximateMode(approxOnly);

      try {
        locationWatchId = await Geolocation.watchPosition(
          {
            enableHighAccuracy: s.enableHighAccuracy,
            timeout: 25000,
            maximumAge: 10000,
            interval: 30000,
            minimumUpdateInterval: 25000,
          },
          async (position, err) => {
            if (err || !position) return;
            // Reject fixes worse than our ceiling so one wildly uncertain reading
            // does not jump the forecast to the wrong area.
            const acc = position.coords.accuracy;
            if (!Number.isFinite(acc) || acc > s.maxM) return;
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

    /**
     * Refresh callback the layout invokes when the app resumes from background.
     */
    async function onAppResumed() {
      await loadWeatherOnOpenOrResume();
    }

    onDestroy(() => {
      if (suggestTimer) clearTimeout(suggestTimer);
      void stopGpsWatch();
      unregisterHomeRefresh(onAppResumed);
    });

    onMount(() => {
      registerHomeRefresh(onAppResumed);

      if (isBootstrapped()) {
        // Coming back from a sub-page (Hourly / Daily / Alerts) within the same
        // app session — repaint from cache and resume GPS tracking, but don't
        // hit the network again.
        const cached = readForecastCache<WeatherApiResponse>();
        if (cached) {
          suppressSuggestOnce = true;
          city = cached.response.location.name;
          applyForecastResponse(cached.response, { notify: false });
          void startGpsWatch(cached.response.location.lat, cached.response.location.lon);
        }
      } else {
        void loadWeatherOnOpenOrResume();
      }
    });

    let locationPending = $state(false);

    let lastNotifiedLocationKey: string | null = null;

    function applyForecastResponse(resp: WeatherApiResponse, opts?: { notify?: boolean }) {
      data = resp;
      buildHourlyAndDaily(resp);
      const notify = opts?.notify ?? true;
      if (notify) {
        void syncWeatherNotification(resp, currentPrecipChancePct);

        // Reset dedup keys when the user switches to a different location so
        // alerts for the new place aren't suppressed by stale entries.
        const locKey = `${resp.location?.lat?.toFixed(3)},${resp.location?.lon?.toFixed(3)}`;
        if (lastNotifiedLocationKey && lastNotifiedLocationKey !== locKey) {
          clearNotifiedAlerts();
        }
        lastNotifiedLocationKey = locKey;

        void syncAlertNotifications(getAlerts(resp));
      }
    }

    async function ensureLocationPermission(): Promise<boolean> {
      try {
        const checked = await Geolocation.checkPermissions();
        if (checked.location === "granted" || checked.coarseLocation === "granted") {
          return true;
        }
        try {
          const requested = await Geolocation.requestPermissions();
          if (requested.location !== "granted" && requested.coarseLocation !== "granted") {
            error = "Location permission denied. Enter a city to get weather.";
            return false;
          }
        } catch {
          // Web: requestPermissions is unimplemented; getCurrentPosition will trigger the browser prompt.
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
      // Mark before the network call so that a back-nav while we're fetching
      // doesn't kick off a second concurrent refresh.
      markBootstrapped();
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
        error = "Enter a city or use current location.";
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
    <button type="button" onclick={fetchWeather} disabled={loading}>Get Weather</button>
    <button type="button" onclick={() => loadWeatherFromCurrentLocation()} disabled={loading}>Use Current Location</button>
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

  {#if data}
    <nav class="forecast-nav" aria-label="Forecast sections">
      <a class="nav-link" href="/hourly">
        <span class="nav-icon" aria-hidden="true">⏱️</span>
        <span class="nav-label">Hourly</span>
        <span class="nav-meta">Next 72 hours</span>
      </a>
      <a class="nav-link" href="/daily">
        <span class="nav-icon" aria-hidden="true">📅</span>
        <span class="nav-label">Daily</span>
        <span class="nav-meta">Next 3 days</span>
      </a>
      <a class="nav-link" href="/alerts" class:has-alerts={alertCount > 0}>
        <span class="nav-icon" aria-hidden="true">⚠️</span>
        <span class="nav-label">Alerts</span>
        <span class="nav-meta">
          {#if alertCount > 0}
            {alertCount} active
          {:else}
            None active
          {/if}
        </span>
      </a>
    </nav>
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
    /* Fluid base font size: scales with viewport, clamped for tiny / large screens. */
    font-size: clamp(0.95rem, 0.85rem + 0.6vw, 1.1rem);
    line-height: 1.4;
  }

  .page h1 {
    font-size: clamp(1.4rem, 1.1rem + 1.8vw, 2rem);
    line-height: 1.2;
    margin: 0.2rem 0 0.6rem;
  }

  .page h2 {
    font-size: clamp(1.15rem, 0.95rem + 1.2vw, 1.6rem);
    line-height: 1.25;
    margin: 0 0 0.5rem;
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
    /* 16px+ avoids iOS Safari zoom-on-focus and stays readable on tiny screens. */
    font-size: clamp(1rem, 0.92rem + 0.4vw, 1.05rem);
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
    font-size: clamp(0.9rem, 0.84rem + 0.3vw, 1rem);
  }

  .unit-select {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: clamp(0.85rem, 0.8rem + 0.25vw, 0.95rem);
  }

  .unit-label {
    opacity: 0.75;
  }

  .unit-select select {
    padding: 0.4rem 0.5rem;
    border-radius: 6px;
    border: 1px solid #ccc;
    background: white;
    font-size: inherit;
  }

  .suggest-hint {
    margin-top: 0.25rem;
    font-size: clamp(0.78rem, 0.74rem + 0.2vw, 0.9rem);
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
    font-size: clamp(0.9rem, 0.85rem + 0.3vw, 1rem);
  }

  .suggestion-meta {
    font-size: clamp(0.78rem, 0.74rem + 0.2vw, 0.9rem);
    opacity: 0.75;
    margin-top: 0.05rem;
  }

  .card {
    margin-top: 1rem;
    padding: 1rem;
    border-radius: 12px;
    background: #f3f3f3;
  }

  .forecast-nav {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.6rem;
    margin-top: 1rem;
  }

  @media (max-width: 480px) {
    .forecast-nav {
      grid-template-columns: 1fr;
    }
  }

  .nav-link {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    padding: 0.85rem 0.5rem;
    border-radius: 12px;
    background: #f3f3f3;
    border: 1px solid rgba(15, 23, 42, 0.08);
    color: inherit;
    text-decoration: none;
    transition: transform 0.08s ease, background 0.12s ease, border-color 0.12s ease;
  }

  .nav-link:hover {
    background: #ececec;
    border-color: rgba(15, 23, 42, 0.18);
  }

  .nav-link:active {
    transform: scale(0.98);
  }

  .nav-link.has-alerts {
    background: #fff4e5;
    border-color: #f5b977;
    color: #7a3d00;
  }

  .nav-link.has-alerts:hover {
    background: #ffe9cc;
  }

  .nav-icon {
    font-size: 1.4rem;
    line-height: 1;
  }

  .nav-label {
    font-weight: 600;
    font-size: clamp(0.95rem, 0.88rem + 0.3vw, 1.05rem);
  }

  .nav-meta {
    font-size: clamp(0.75rem, 0.7rem + 0.2vw, 0.85rem);
    opacity: 0.75;
  }
</style>
