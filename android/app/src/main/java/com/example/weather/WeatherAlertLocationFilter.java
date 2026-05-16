package com.example.weather;

import androidx.annotation.Nullable;

import org.json.JSONObject;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Drops WeatherAPI alerts whose {@code areas} list only other US states/territories than the forecast
 * location. Logic mirrors TypeScript {@code alertLocationRelevance.ts}.
 */
final class WeatherAlertLocationFilter {

    private static final Map<String, String> STATE_NAME_TO_CODE = new HashMap<>();
    private static final Set<String> VALID_CODES = new HashSet<>();
    private static final List<String> STATE_NAMES_LONG_TO_SHORT = new ArrayList<>();
    private static final String[] ALERT_TEXT_FIELDS =
        new String[] { "headline", "areas", "event", "note", "desc", "instruction" };

    private static final Pattern CODE_AFTER_DELIM = Pattern.compile("(?:^|[,;|])\\s*([A-Za-z]{2})\\b");
    private static final Pattern NWS_ZONE_CODE = Pattern.compile("\\b([A-Z]{2})[CZ]\\d{3}\\b");

    static {
        put("alabama", "AL");
        put("alaska", "AK");
        put("arizona", "AZ");
        put("arkansas", "AR");
        put("california", "CA");
        put("colorado", "CO");
        put("connecticut", "CT");
        put("delaware", "DE");
        put("district of columbia", "DC");
        put("florida", "FL");
        put("georgia", "GA");
        put("hawaii", "HI");
        put("idaho", "ID");
        put("illinois", "IL");
        put("indiana", "IN");
        put("iowa", "IA");
        put("kansas", "KS");
        put("kentucky", "KY");
        put("louisiana", "LA");
        put("maine", "ME");
        put("maryland", "MD");
        put("massachusetts", "MA");
        put("michigan", "MI");
        put("minnesota", "MN");
        put("mississippi", "MS");
        put("missouri", "MO");
        put("montana", "MT");
        put("nebraska", "NE");
        put("nevada", "NV");
        put("new hampshire", "NH");
        put("new jersey", "NJ");
        put("new mexico", "NM");
        put("new york", "NY");
        put("north carolina", "NC");
        put("north dakota", "ND");
        put("ohio", "OH");
        put("oklahoma", "OK");
        put("oregon", "OR");
        put("pennsylvania", "PA");
        put("rhode island", "RI");
        put("south carolina", "SC");
        put("south dakota", "SD");
        put("tennessee", "TN");
        put("texas", "TX");
        put("utah", "UT");
        put("vermont", "VT");
        put("virginia", "VA");
        put("washington", "WA");
        put("west virginia", "WV");
        put("wisconsin", "WI");
        put("wyoming", "WY");
        put("guam", "GU");
        put("puerto rico", "PR");
        put("american samoa", "AS");
        put("u.s. virgin islands", "VI");
        put("virgin islands", "VI");
        put("northern mariana islands", "MP");

        STATE_NAMES_LONG_TO_SHORT.addAll(STATE_NAME_TO_CODE.keySet());
        STATE_NAMES_LONG_TO_SHORT.sort((a, b) -> Integer.compare(b.length(), a.length()));
    }

    private static void put(String name, String code) {
        STATE_NAME_TO_CODE.put(name, code);
        VALID_CODES.add(code);
    }

    private WeatherAlertLocationFilter() {}

    static boolean isAlertRelevantToLocation(JSONObject alert, @Nullable JSONObject locationObj) {
        if (locationObj == null || alert == null) return true;
        String areas = trim(alert.optString("areas", ""));
        String text = alertSearchText(alert);
        if (text.isEmpty()) return true;

        String country = trim(locationObj.optString("country", ""));
        boolean us = isUnitedStatesCountry(country);
        String userState = us ? userUsStateCode(trim(locationObj.optString("region", ""))) : null;

        if (us && userState != null) {
            Set<String> mentioned = statesMentionedInAlertText(text, areas);
            if (!mentioned.isEmpty()) {
                return mentioned.contains(userState);
            }
            return true;
        }
        return true;
    }

    private static boolean isUnitedStatesCountry(String country) {
        if (country.isEmpty()) return false;
        String u = country.toUpperCase(Locale.ROOT);
        if ("US".equals(u) || "USA".equals(u)) return true;
        return u.contains("UNITED STATES");
    }

    @Nullable
    private static String userUsStateCode(String region) {
        if (region.isEmpty()) return null;
        if (region.length() == 2 && region.matches("^[A-Za-z]{2}$")) {
            String code = region.toUpperCase(Locale.ROOT);
            if (VALID_CODES.contains(code)) return code;
        }
        String fromName = STATE_NAME_TO_CODE.get(region.toLowerCase(Locale.ROOT));
        return fromName;
    }

    private static String alertSearchText(JSONObject alert) {
        StringBuilder sb = new StringBuilder();
        for (String field : ALERT_TEXT_FIELDS) {
            String value = trim(alert.optString(field, ""));
            if (!value.isEmpty()) {
                if (sb.length() > 0) sb.append('\n');
                sb.append(value);
            }
        }
        return sb.toString();
    }

    private static Set<String> statesMentionedInAlertText(String textRaw, String areasRaw) {
        Set<String> found = new HashSet<>();
        String text = textRaw.trim();
        if (text.isEmpty()) return found;

        for (String name : STATE_NAMES_LONG_TO_SHORT) {
            Pattern re = Pattern.compile("\\b" + Pattern.quote(name) + "\\b", Pattern.CASE_INSENSITIVE);
            if (re.matcher(text).find()) {
                String code = STATE_NAME_TO_CODE.get(name);
                if (code != null) found.add(code);
            }
        }

        Matcher m = CODE_AFTER_DELIM.matcher(areasRaw);
        while (m.find()) {
            String code = m.group(1).toUpperCase(Locale.ROOT);
            if (VALID_CODES.contains(code)) found.add(code);
        }

        Matcher zone = NWS_ZONE_CODE.matcher(text.toUpperCase(Locale.ROOT));
        while (zone.find()) {
            String code = zone.group(1).toUpperCase(Locale.ROOT);
            if (VALID_CODES.contains(code)) found.add(code);
        }
        return found;
    }

    private static String trim(String s) {
        return s == null ? "" : s.trim();
    }
}
