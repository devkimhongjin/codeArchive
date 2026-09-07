package com.codearchive.api.integration.github;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

public final class GitHubUploadPath {
    private static final Map<String, String> EXTENSIONS = Map.of(
            "java", "java", "python", "py", "javascript", "js", "typescript", "ts", "c++", "cpp");
    private GitHubUploadPath() {}

    public static String extension(String language) {
        return EXTENSIONS.getOrDefault(language.trim().toLowerCase(Locale.ROOT), "txt");
    }

    public static String choose(String requested, String platform, String problem, String language) {
        String extension = extension(language);
        String path = requested == null ? platform + "/" + problem + "/Solution." + extension : requested;
        segments(path);
        if (!path.endsWith("." + extension)) invalid();
        return path;
    }

    public static List<String> segments(String path) {
        if (path == null || path.isEmpty() || path.getBytes(StandardCharsets.UTF_8).length > 1024) invalid();
        String[] segments = path.split("/", -1);
        if (segments.length > GitHubBrowseInput.MAX_DEPTH + 1) invalid();
        for (String segment : segments) {
            // Reuse the conservative browsing character policy, then add output-specific exclusions.
            if (!GitHubBrowseInput.validDirectory(segment) || segment.isEmpty()
                    || segment.equalsIgnoreCase(".github")
                    || segment.matches("(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\\..*)?")) invalid();
        }
        String parent = segments.length == 1 ? "" : String.join("/", Arrays.copyOf(segments, segments.length - 1));
        GitHubBrowseInput.directory(parent);
        return List.of(segments);
    }

    public static String commitMessage(String requested, String platform, String problem) {
        String message = requested == null ? "Add " + platform + " " + problem + " solution" : requested;
        if (message.isBlank() || message.getBytes(StandardCharsets.UTF_8).length > 200
                || message.codePoints().anyMatch(c -> Character.isISOControl(c)
                        || Character.getType(c) == Character.FORMAT)) invalid();
        return message;
    }

    private static void invalid() { throw new CodeArchiveException(ErrorCode.INVALID_REQUEST); }
}
