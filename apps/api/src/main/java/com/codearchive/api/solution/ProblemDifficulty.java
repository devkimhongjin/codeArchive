package com.codearchive.api.solution;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;

/** Optional site metadata. Invalid or unverified scales are omitted, never guessed. */
public record ProblemDifficulty(String label, String problemNumber, String sourceUrl) {
    public static ProblemDifficulty validated(Platform platform, String number, String problemUrl, ProblemDifficulty value) {
        if (value == null || !number.equals(value.problemNumber()) || value.label() == null || value.sourceUrl() == null || value.sourceUrl().length() > 2048) return null;
        try {
            URI source = URI.create(value.sourceUrl()), problem = URI.create(problemUrl);
            if (!"https".equals(source.getScheme()) || source.getUserInfo() != null || source.getPort() != -1 || source.getFragment() != null) return null;
            if (platform == Platform.PROGRAMMERS && value.label().matches("Lv\\. [0-5]") && "school.programmers.co.kr".equals(source.getHost())
                    && "/learn/challenges".equals(source.getPath()) && source.getRawQuery() == null && source.getHost().equals(problem.getHost()) && "https".equals(problem.getScheme())
                    && ("/learn/courses/30/lessons/" + number).equals(problem.getPath()) && number.matches("[0-9]{1,40}")) return value;
            if (platform == Platform.SWEA && value.label().matches("D[1-8]") && "swexpertacademy.com".equals(source.getHost()) && source.getHost().equals(problem.getHost()) && "https".equals(problem.getScheme())
                    && List.of("/main/code/problem/problemDetail.do", "/main/code/userProblem/userProblemDetail.do").contains(source.getPath()) && source.getPath().equals(problem.getPath())) {
                String sourceId = contestId(source), problemId = contestId(problem);
                if (sourceId != null && sourceId.matches("[A-Za-z0-9_-]{1,160}") && sourceId.equals(problemId)) return new ProblemDifficulty(value.label(), number, "https://swexpertacademy.com" + source.getPath() + "?contestProbId=" + sourceId);
            }
        } catch (IllegalArgumentException ignored) { }
        return null;
    }
    private static String contestId(URI value) {
        if (value.getRawQuery() == null) return null;
        var ids = Arrays.stream(value.getRawQuery().split("&")).map(part -> part.split("=", 2))
                .filter(pair -> "contestProbId".equals(URLDecoder.decode(pair[0], StandardCharsets.UTF_8)))
                .map(pair -> pair.length == 2 ? URLDecoder.decode(pair[1], StandardCharsets.UTF_8) : "").toList();
        return ids.size() == 1 ? ids.get(0) : null;
    }
}
