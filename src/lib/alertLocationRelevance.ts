import type { WeatherApiAlert, WeatherApiLocation } from "./forecast";

/** Lowercase US state / territory name → USPS code (aligned with Java {@code WeatherAlertLocationFilter}). */
const STATE_NAME_TO_CODE: Readonly<Record<string, string>> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  guam: "GU",
  "puerto rico": "PR",
  "american samoa": "AS",
  "u.s. virgin islands": "VI",
  "virgin islands": "VI",
  "northern mariana islands": "MP",
};

const VALID_STATE_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

/** Longest names first so "new york" wins over "new" / "york" substring issues. */
const STATE_NAMES_LONG_TO_SHORT = Object.keys(STATE_NAME_TO_CODE).sort(
  (a, b) => b.length - a.length,
);

function isUnitedStatesCountry(country: string | undefined): boolean {
  if (!country) return false;
  const u = country.trim().toUpperCase();
  if (u === "US" || u === "USA") return true;
  return u.includes("UNITED STATES");
}

function userUsStateCode(region: string | undefined): string | null {
  if (!region) return null;
  const r = region.trim();
  if (/^[A-Za-z]{2}$/.test(r)) {
    const code = r.toUpperCase();
    if (VALID_STATE_CODES.has(code)) return code;
  }
  const fromName = STATE_NAME_TO_CODE[r.toLowerCase()];
  return fromName ?? null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

const ALERT_TEXT_FIELDS = [
  "headline",
  "areas",
  "event",
  "note",
  "desc",
  "instruction",
] as const satisfies readonly (keyof WeatherApiAlert)[];

function alertSearchText(alert: WeatherApiAlert): string {
  return ALERT_TEXT_FIELDS.map((field) => alert[field])
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .join("\n");
}

/** USPS codes explicitly mentioned in CAP-style alert text. */
function statesMentionedInAlertText(textRaw: string, areasRaw: string): Set<string> {
  const found = new Set<string>();
  const text = textRaw.trim();
  if (!text) return found;

  const lower = text.toLowerCase();
  for (const name of STATE_NAMES_LONG_TO_SHORT) {
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
    if (re.test(lower)) {
      const code = STATE_NAME_TO_CODE[name];
      if (code) found.add(code);
    }
  }

  const codeAfterDelim = /(?:^|[,;|])\s*([A-Za-z]{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = codeAfterDelim.exec(areasRaw)) !== null) {
    const code = m[1].toUpperCase();
    if (VALID_STATE_CODES.has(code)) found.add(code);
  }

  const nwsZoneCode = /\b([A-Z]{2})[CZ]\d{3}\b/g;
  while ((m = nwsZoneCode.exec(text.toUpperCase())) !== null) {
    const code = m[1].toUpperCase();
    if (VALID_STATE_CODES.has(code)) found.add(code);
  }

  return found;
}

/**
 * Fallback for US WeatherAPI alerts when exact NWS point alerts are unavailable: keep alerts that either
 * name the user's state or do not name enough state information to prove they belong elsewhere.
 */
export function filterAlertsForLocation(
  alerts: WeatherApiAlert[],
  location: WeatherApiLocation | null | undefined,
): WeatherApiAlert[] {
  if (!location || alerts.length === 0) return alerts;

  const country = location.country;
  const us = isUnitedStatesCountry(country);
  const userState = us ? userUsStateCode(location.region) : null;

  return alerts.filter((alert) => {
    const areas = alert.areas?.trim() ?? "";
    const text = alertSearchText(alert);
    if (!text) return true;

    if (us && userState != null) {
      const mentioned = statesMentionedInAlertText(text, areas);
      if (mentioned.size > 0) {
        return mentioned.has(userState);
      }
      return true;
    }

    if (us && userState == null) {
      return true;
    }

    return true;
  });
}
