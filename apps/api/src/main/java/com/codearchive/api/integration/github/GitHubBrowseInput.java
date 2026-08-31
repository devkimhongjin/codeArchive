package com.codearchive.api.integration.github;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;

import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

final class GitHubBrowseInput {
    static final int MAX_DEPTH = 8;
    private GitHubBrowseInput() {}

    static void identifiers(long installationId, long repositoryId) {
        require(installationId > 0 && repositoryId > 0);
    }

    static void page(int page) { require(page >= 1 && page <= 10000); }

    static void reference(String branch, String expectedCommitSha) {
        require(validBranch(branch) && validSha(expectedCommitSha));
    }

    static boolean validSha(String sha) {
        return sha != null && sha.matches("[0-9a-f]{40}");
    }

    static boolean validBranch(String branch) {
        if (branch == null || branch.isEmpty() || bytes(branch) > 255 || branch.startsWith("-")
                || branch.equals("@") || branch.contains("..") || branch.contains("@{")
                || branch.endsWith(".") || branch.codePoints().anyMatch(c ->
                        Character.isISOControl(c) || Character.isWhitespace(c)
                                || "~^:?*[\\%".indexOf(c) >= 0)) return false;
        return Arrays.stream(branch.split("/", -1)).allMatch(segment ->
                !segment.isEmpty() && !segment.startsWith(".") && !segment.endsWith(".lock"));
    }

    static List<String> directory(String path) {
        require(validDirectory(path));
        return path.isEmpty() ? List.of() : List.of(path.split("/"));
    }

    static boolean validDirectory(String path) {
        if (path == null || bytes(path) > 1024) return false;
        if (path.isEmpty()) return true;
        String[] segments = path.split("/", -1);
        return segments.length <= MAX_DEPTH && Arrays.stream(segments).allMatch(GitHubBrowseInput::safeSegment);
    }

    private static boolean safeSegment(String segment) {
        return !segment.isBlank() && bytes(segment) <= 255
                && !segment.equals(".") && !segment.equals("..") && !segment.equalsIgnoreCase(".git")
                && !segment.endsWith(".") && !segment.endsWith(" ")
                && segment.codePoints().noneMatch(c -> Character.isISOControl(c)
                        || Character.getType(c) == Character.FORMAT || "\\:%*?\"<>|".indexOf(c) >= 0);
    }

    private static int bytes(String value) { return value.getBytes(StandardCharsets.UTF_8).length; }

    private static void require(boolean valid) {
        if (!valid) throw new CodeArchiveException(ErrorCode.INVALID_REQUEST);
    }
}
