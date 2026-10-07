package com.codearchive.api.settings;

import java.util.Arrays;
import java.util.List;
import java.util.Set;

/** Stored as a small allowlisted CSV, never user-authored source text. */
public final class HeaderFields {
    public static final List<String> DEFAULT = List.of("identity", "title", "url", "language", "performance");
    private static final Set<String> ALLOWED = Set.of("identity", "title", "solvedAt", "language", "performance", "url");
    private HeaderFields() {}

    public static boolean valid(List<String> fields) {
        return fields == null || fields.size() <= ALLOWED.size() && fields.stream().allMatch(field -> field != null && ALLOWED.contains(field)) && Set.copyOf(fields).size() == fields.size();
    }

    public static String encode(List<String> fields) {
        if (!valid(fields) || fields == null) throw new IllegalArgumentException("Invalid header fields");
        return String.join(",", fields);
    }

    public static List<String> parse(String encoded) {
        if (encoded == null) return DEFAULT;
        if (encoded.isEmpty()) return List.of();
        List<String> fields = Arrays.asList(encoded.split(",", -1));
        return valid(fields) ? List.copyOf(fields) : DEFAULT;
    }
}
