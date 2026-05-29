import type { CitySearchSuggestion } from "$lib/citySearchSuggestions";
import type { WeatherApiLocation } from "$lib/forecast";

const STORAGE_KEY = "weatherApp.favorites.v1";
const MAX_FAVORITES = 20;

export type FavoriteLocation = {
	id: string;
	label: string;
	query: string;
	lat: number;
	lon: number;
	region?: string;
	country?: string;
	addedAt: number;
};

type FavoriteLocationsRecord = {
	v: 1;
	items: FavoriteLocation[];
};

function safeParse(raw: string | null): FavoriteLocationsRecord | null {
	if (!raw) return null;
	try {
		const o = JSON.parse(raw) as FavoriteLocationsRecord;
		if (o?.v !== 1 || !Array.isArray(o.items)) return null;
		const items = o.items.filter(
			(item) =>
				item &&
				typeof item.id === "string" &&
				typeof item.label === "string" &&
				typeof item.query === "string" &&
				typeof item.lat === "number" &&
				typeof item.lon === "number" &&
				typeof item.addedAt === "number"
		);
		return { v: 1, items };
	} catch {
		return null;
	}
}

function writeRecord(items: FavoriteLocation[]): void {
	if (typeof localStorage === "undefined") return;
	const rec: FavoriteLocationsRecord = { v: 1, items };
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
	} catch {
		/* quota / private mode */
	}
}

function normalizeQuery(q: string): string {
	return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const R = 6371000;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * Max distance (m) to treat geocoder vs API coordinates as the same place.
 * This only reconciles small drift between a geocoder and the weather API for
 * the *same* location, so it must stay tight enough not to swallow neighbouring
 * towns (e.g. Salem and Swampscott, MA are only ~6 km apart).
 */
const MATCH_RADIUS_M = 1_500;

/** City portion of a query/label, e.g. "Salem, Massachusetts, US" -> "salem". */
function cityName(value: string | undefined): string {
	if (!value) return "";
	return normalizeQuery(value.split(",")[0] ?? value);
}

export function findMatchingFavorite(
	items: FavoriteLocation[],
	opts: { lat: number; lon: number; query?: string }
): FavoriteLocation | undefined {
	const id = buildFavoriteId(opts.lat, opts.lon);
	const byId = items.find((f) => f.id === id);
	if (byId) return byId;

	if (opts.query) {
		const nq = normalizeQuery(opts.query);
		const byQuery = items.find((f) => normalizeQuery(f.query) === nq);
		if (byQuery) return byQuery;
	}

	// Proximity fallback: only accept a nearby favorite when its city name also
	// agrees, so distinct neighbouring towns are never conflated. Without a name
	// to verify against, distance alone is not trusted.
	const targetName = cityName(opts.query);
	if (!targetName) return undefined;
	return items.find(
		(f) =>
			haversineMeters(f.lat, f.lon, opts.lat, opts.lon) <= MATCH_RADIUS_M &&
			(cityName(f.query) === targetName || cityName(f.label) === targetName)
	);
}

export function matchesFavoriteLocation(
	items: FavoriteLocation[],
	lat: number,
	lon: number,
	query?: string
): boolean {
	return findMatchingFavorite(items, { lat, lon, query }) !== undefined;
}

export function buildFavoriteId(lat: number, lon: number): string {
	return `geo:${lat.toFixed(4)},${lon.toFixed(4)}`;
}

export function buildLocationLabel(name: string, region?: string, country?: string): string {
	return [name, region, country].filter(Boolean).join(", ");
}

export function buildQueryFromSuggestion(s: CitySearchSuggestion): string {
	return `${s.name}, ${s.region ? `${s.region}, ` : ""}${s.country}`.replace(", ,", ",").trim();
}

export function favoriteFromSuggestion(s: CitySearchSuggestion): FavoriteLocation {
	return {
		id: buildFavoriteId(s.lat, s.lon),
		label: buildLocationLabel(s.name, s.region, s.country),
		query: buildQueryFromSuggestion(s),
		lat: s.lat,
		lon: s.lon,
		region: s.region || undefined,
		country: s.country || undefined,
		addedAt: Date.now(),
	};
}

export function favoriteFromWeatherLocation(
	loc: WeatherApiLocation,
	query: string
): FavoriteLocation {
	return {
		id: buildFavoriteId(loc.lat, loc.lon),
		label: buildLocationLabel(loc.name, loc.region, loc.country),
		query,
		lat: loc.lat,
		lon: loc.lon,
		region: loc.region,
		country: loc.country,
		addedAt: Date.now(),
	};
}

export function readFavoriteLocations(): FavoriteLocation[] {
	if (typeof localStorage === "undefined") return [];
	const rec = safeParse(localStorage.getItem(STORAGE_KEY));
	return rec?.items ?? [];
}

export function isFavoriteLocation(id: string): boolean {
	return readFavoriteLocations().some((f) => f.id === id);
}

export function isFavoriteLatLon(lat: number, lon: number, query?: string): boolean {
	return matchesFavoriteLocation(readFavoriteLocations(), lat, lon, query);
}

/** Align stored favorite coordinates with the API location after a successful fetch. */
export function syncFavoriteWithWeatherLocation(
	query: string,
	loc: WeatherApiLocation
): FavoriteLocation[] {
	const items = readFavoriteLocations();
	const match = findMatchingFavorite(items, { lat: loc.lat, lon: loc.lon, query });
	if (!match) return items;

	const updated: FavoriteLocation = {
		...match,
		id: buildFavoriteId(loc.lat, loc.lon),
		label: buildLocationLabel(loc.name, loc.region, loc.country),
		query,
		lat: loc.lat,
		lon: loc.lon,
		region: loc.region,
		country: loc.country,
	};

	writeRecord(items.map((f) => (f.id === match.id ? updated : f)));
	return readFavoriteLocations();
}

export function addFavoriteLocation(loc: FavoriteLocation): FavoriteLocation[] {
	const items = readFavoriteLocations().filter((f) => f.id !== loc.id);
	items.unshift({ ...loc, addedAt: Date.now() });
	writeRecord(items.slice(0, MAX_FAVORITES));
	return readFavoriteLocations();
}

export function removeFavoriteLocation(id: string): FavoriteLocation[] {
	writeRecord(readFavoriteLocations().filter((f) => f.id !== id));
	return readFavoriteLocations();
}

export function toggleFavoriteLocation(loc: FavoriteLocation): {
	items: FavoriteLocation[];
	added: boolean;
} {
	const items = readFavoriteLocations();
	const existing = findMatchingFavorite(items, { lat: loc.lat, lon: loc.lon, query: loc.query });
	if (existing) {
		return { items: removeFavoriteLocation(existing.id), added: false };
	}
	return { items: addFavoriteLocation(loc), added: true };
}
