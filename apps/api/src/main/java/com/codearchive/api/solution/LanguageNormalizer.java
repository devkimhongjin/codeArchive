package com.codearchive.api.solution;

import java.util.Locale;

/** Canonical language contract shared with the dashboard/extension implementation. */
public final class LanguageNormalizer {
    private LanguageNormalizer() {
    }

    public static String canonicalKey(String language) {
        String folded = language == null ? "" : language.trim().toLowerCase(Locale.ROOT)
                .replaceAll("[\\s_.-]+", "");
        if (folded.matches("^(typescript|ts)(?:\\d.*)?$")) return "typescript";
        if (folded.matches("^(javascript|js|nodejs)(?:\\d.*)?$")) return "javascript";
        if (folded.matches("^(python|python3|pypy|pypy3)(?:\\d.*)?$")) return "python";
        if (folded.matches("^kotlin(?:\\d.*)?$")) return "kotlin";
        if (folded.matches("^java(?:$|(?:\\(|\\d|openjdk|jdk).*)")) return "java";
        if (folded.matches("^(c\\+\\+|cpp|g\\+\\+)(?:\\d.*)?$")) return "cpp";
        if (folded.matches("^(c#|csharp)(?:\\d.*)?$")) return "csharp";
        if (folded.matches("^(c|c\\(gcc\\)|gcc)(?:\\d.*)?$")) return "c";
        if (folded.matches("^go(?:\\d.*)?$")) return "go";
        if (folded.matches("^rust(?:\\d.*)?$")) return "rust";
        if (folded.matches("^ruby(?:\\d.*)?$")) return "ruby";
        if (folded.matches("^swift(?:\\d.*)?$")) return "swift";
        if (folded.matches("^scala(?:\\d.*)?$")) return "scala";
        if (folded.matches("^(sql|mysql|postgresql)(?:\\d.*)?$")) return "sql";
        String unknown = folded.isEmpty() ? "empty" : folded;
        return "unknown:" + unknown.substring(0, Math.min(unknown.length(), 92));
    }
}
