/**
 * City / town suggestions for the home search field.
 * - Open-Meteo geocoding resolves names and recognises country-level queries.
 * - Photon (OSM) expands a country into many settlements (city/town/village/hamlet) inside that country only.
 */
export type CitySearchSuggestion = {
	id: number;
	name: string;
	region: string;
	country: string;
	lat: number;
	lon: number;
	/** Stable differentiation for list keys (and debugging). */
	url: string;
};

const OPEN_METEO_SEARCH = "https://geocoding-api.open-meteo.com/v1/search";
const PHOTON_API = "https://photon.komoot.io/api/";

const ALPHA = "abcdefghijklmnopqrstuvwxyz".split("");

const PLACE_FILTERS = ["place:city", "place:town", "place:village", "place:hamlet"] as const;

const PHOTON_CONCURRENCY = 5;

type OpenMeteoResult = {
	id: number;
	name: string;
	latitude: number;
	longitude: number;
	feature_code: string;
	country_code?: string;
	country?: string;
	admin1?: string;
	admin2?: string;
};

type PhotonFeature = {
	geometry: { type: string; coordinates: [number, number] };
	properties: {
		name: string;
		country?: string;
		state?: string;
		county?: string;
		osm_type: string;
		osm_id: number;
	};
};

function normalize(s: string): string {
	return s
		.trim()
		.toLowerCase()
		.replace(/\./g, "")
		.replace(/\s+/g, " ");
}

function isPopulatedPlaceOm(r: OpenMeteoResult): boolean {
	const code = r.feature_code ?? "";
	if (code === "PCLI") return false;
	return code.startsWith("PPL");
}

/** FNV-1a 32-bit → unsigned int for suggestion id (Photon has no numeric id). */
function hashToUint(key: string): number {
	let h = 2166136261;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
	const res = await fetch(url, { signal });
	if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
	return res.json() as Promise<T>;
}

async function openMeteoSearch(
	q: string,
	signal: AbortSignal | undefined,
	extra: Record<string, string>,
): Promise<OpenMeteoResult[]> {
	const params = new URLSearchParams({
		name: q,
		language: "en",
		format: "json",
		count: "100",
		...extra,
	});
	const url = `${OPEN_METEO_SEARCH}?${params}`;
	const data = await fetchJson<{ results?: OpenMeteoResult[] }>(url, signal);
	return Array.isArray(data.results) ? data.results : [];
}

function openMeteoToSuggestions(results: OpenMeteoResult[]): CitySearchSuggestion[] {
	return results.filter(isPopulatedPlaceOm).map((r) => ({
		id: r.id >>> 0,
		name: r.name,
		region: r.admin1 ?? r.admin2 ?? "",
		country: r.country ?? "",
		lat: r.latitude,
		lon: r.longitude,
		url: `open-meteo:${r.id}`,
	}));
}

function pickCountryRow(results: OpenMeteoResult[], query: string): OpenMeteoResult | undefined {
	const want = normalize(query);
	return results.find(
		(r) =>
			r.feature_code === "PCLI" &&
			r.country_code &&
			(normalize(r.name) === want || normalize(r.country ?? "") === want),
	);
}

async function fetchSettlementsPhotonForCountry(
	countryCode: string,
	signal?: AbortSignal,
): Promise<CitySearchSuggestion[]> {
	const cc = countryCode.trim().toLowerCase();
	if (!cc) return [];

	const seen = new Set<string>();
	const out: CitySearchSuggestion[] = [];

	async function runLetter(letter: string): Promise<void> {
		const url = new URL(PHOTON_API);
		url.searchParams.set("q", letter);
		url.searchParams.set("countrycode", cc);
		url.searchParams.set("limit", "100");
		url.searchParams.set("lang", "en");
		for (const tag of PLACE_FILTERS) url.searchParams.append("osm_tag", tag);

		let data: { features?: PhotonFeature[] };
		try {
			data = await fetchJson<{ features?: PhotonFeature[] }>(url.toString(), signal);
		} catch {
			return;
		}

		for (const f of data.features ?? []) {
			if (signal?.aborted) return;
			const [lon, lat] = f.geometry.coordinates;
			const p = f.properties;
			const key = `${p.osm_type}:${p.osm_id}`;
			if (seen.has(key)) continue;
			seen.add(key);

			out.push({
				id: hashToUint(`photon:${key}`),
				name: p.name,
				region: p.state ?? p.county ?? "",
				country: p.country ?? "",
				lat,
				lon,
				url: `photon:${key}`,
			});
		}
	}

	let next = 0;
	async function worker(): Promise<void> {
		while (next < ALPHA.length) {
			const i = next++;
			await runLetter(ALPHA[i]!);
		}
	}

	const workers = Array.from({ length: PHOTON_CONCURRENCY }, () => worker());
	await Promise.all(workers);

	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

	out.sort((a, b) =>
		a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
	);
	return out;
}

/**
 * @param q trimmed query, length ≥ 2
 */
export async function fetchCitySearchSuggestions(
	q: string,
	opts?: { signal?: AbortSignal },
): Promise<CitySearchSuggestion[]> {
	const signal = opts?.signal;

	if (q.includes(",")) {
		const rows = await openMeteoSearch(q.trim(), signal, {});
		return openMeteoToSuggestions(rows);
	}

	const trimmed = q.trim();

	const broad = await openMeteoSearch(trimmed, signal, {});
	const country = pickCountryRow(broad, trimmed);

	if (country?.country_code) {
		return fetchSettlementsPhotonForCountry(country.country_code, signal);
	}

	return openMeteoToSuggestions(broad);
}
