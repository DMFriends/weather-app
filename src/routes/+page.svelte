<script lang="ts">
    import { Geolocation } from "@capacitor/geolocation";
    import { PUBLIC_API_KEY } from "$env/static/public";

    type WeatherApiForecastHour = {
      time_epoch: number;
      temp_f: number;
      chance_of_rain: number;
      chance_of_snow: number;
    };

    type WeatherApiForecastDay = {
      date_epoch: number;
      day: {
        maxtemp_f: number;
        mintemp_f: number;
        daily_chance_of_rain: number;
        daily_chance_of_snow: number;
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

    type HourlyForecast = {
      timeEpoch: number;
      label: string;
      dateLabel: string;
      tempF: number;
      precipChancePct: number;
    };

    type DailyForecast = {
      dateEpoch: number;
      label: string;
      highF: number;
      lowF: number;
      precipChancePct: number;
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

    function buildHourlyAndDaily(resp: WeatherApiResponse) {
      const forecastDays = resp.forecast?.forecastday ?? [];
      const allHours = forecastDays.flatMap((d) => d.hour ?? []);

      hourly = allHours.slice(0, 72).map((h) => ({
        timeEpoch: h.time_epoch,
        label: formatHourLabel(h.time_epoch),
        dateLabel: formatHourDateLabel(h.time_epoch),
        tempF: h.temp_f,
        precipChancePct: precipChanceFromRainSnow(h.chance_of_rain, h.chance_of_snow),
      }));

      daily = forecastDays.slice(0, 10).map((d) => ({
        dateEpoch: d.date_epoch,
        label: formatDayLabel(d.date_epoch),
        highF: d.day.maxtemp_f,
        lowF: d.day.mintemp_f,
        precipChancePct: precipChanceFromRainSnow(d.day.daily_chance_of_rain, d.day.daily_chance_of_snow),
      }));

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

    let city = $state("");
    let data: WeatherApiResponse | null = $state(null);
    let hourly: HourlyForecast[] = $state([]);
    let daily: DailyForecast[] = $state([]);
    let currentPrecipChancePct: number | null = $state(null);
    let error = $state("");

    async function fetchWeather() {
      error = "";
      data = null;
      hourly = [];
      daily = [];
      currentPrecipChancePct = null;

      try {
        const resp = await fetchForecast(city);
        data = resp;
        buildHourlyAndDaily(resp);
      } catch (e: any) {
        error = e.message;
        console.error(e);
      }
    }

    export async function getCurrentLocationWeather() {
      const pos = await Geolocation.getCurrentPosition();
      const { latitude, longitude } = pos.coords;
      return await fetchForecast(`${latitude},${longitude}`);
    }
</script>

<main>
  <h1>Weather App</h1>

  <input
    placeholder="Enter city"
    bind:value={city}
  />

  <button onclick={fetchWeather}>
    Get Weather
  </button>

  {#if error}
    <p style="color:red">{error}</p>
  {/if}

  {#if data}
    <div class="card">
      <h2>{data.location.name}</h2>
      <p>🌡️ {data.current.temp_f.toFixed(1)} °F</p>
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
              {Math.round(h.tempF)} °F
            </div>
            <div class="hourly-pop">
              {h.precipChancePct}% precip
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if daily.length}
    <section class="forecast">
      <h3>10-day forecast</h3>
      <div class="daily-list">
        {#each daily as d}
          <div class="daily-item">
            <div class="daily-date">
              {d.label}
            </div>
            <div class="daily-temps">
              <span>High {Math.round(d.highF)} °F</span>
              <span>Low {Math.round(d.lowF)} °F</span>
            </div>
            <div class="daily-pop">
              {d.precipChancePct}% precip
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</main>

<style>
  main {
    padding: 2rem;
    font-family: sans-serif;
    text-align: center;
  }

  input {
    padding: 0.5rem;
    margin: 0.5rem;
  }

  button {
    padding: 0.5rem 1rem;
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
    min-width: 80px;
    padding: 0.5rem;
    border-radius: 8px;
    background: #f8f8f8;
    font-size: 0.85rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .hourly-time {
    font-weight: bold;
    margin-bottom: 0;
  }

  .hourly-date {
    font-size: 0.72rem;
    opacity: 0.7;
    line-height: 1.1;
  }

  .hourly-pop {
    margin-top: 0.15rem;
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

  .daily-temps {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
</style>