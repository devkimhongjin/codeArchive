package com.codearchive.api.community;

import com.codearchive.api.solution.Solution;
import com.codearchive.api.solution.SolutionRepository;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/** Caller holds the account lock and transaction, shared by settings/capture/visibility writes. */
@Service
public class CommunityPublicationPolicy {
    private final SolutionRepository solutions;
    public CommunityPublicationPolicy(SolutionRepository solutions) { this.solutions = solutions; }
    public static boolean valid(String policy) { return List.of("all", "execution", "memory", "length").contains(policy); }
    public void apply(long owner, String policy, boolean includePrivate) {
        var groups = solutions.findByUserIdOrderBySolvedAtDesc(owner).stream()
            .filter(s -> "ACCEPTED".equals(s.getResult()) && (includePrivate || s.isPublished()))
            .collect(Collectors.groupingBy(s -> s.getPlatform().name() + ":" + s.getProblemNumber()));
        for (var group : groups.values()) {
            applyGroup(group, policy);
        }
        solutions.flush();
    }
    public void applyProblem(long owner, com.codearchive.api.solution.Platform platform, String problem, String policy) {
        if ("all".equals(policy)) return;
        var group = solutions.findByUserIdAndPlatformAndProblemNumberAndPublishedAtIsNotNull(owner, platform, problem)
            .stream().filter(s -> "ACCEPTED".equals(s.getResult())).toList();
        if (!group.isEmpty()) applyGroup(group, policy);
        solutions.flush();
    }
    private static void applyGroup(List<Solution> group, String policy) {
        Instant now = Instant.now();
        Solution winner = group.stream().min(comparator(policy)).orElseThrow();
        for (var solution : group) solution.setPublished("all".equals(policy) || solution == winner, now);
    }
    public static Comparator<Solution> comparator(String policy) {
        Comparator<Solution> recent = Comparator.comparing(Solution::getSolvedAt, Comparator.reverseOrder())
            .thenComparing(Solution::getId, Comparator.reverseOrder());
        return switch (policy) {
            case "execution" -> Comparator.comparing((Solution s) -> s.getExecutionTime() == null || s.getExecutionTime().signum() < 0 ? null : s.getExecutionTime(),
                Comparator.nullsLast(BigDecimal::compareTo)).thenComparing(recent);
            case "memory" -> Comparator.comparing(CommunityPublicationPolicy::memoryBytes,
                Comparator.nullsLast(BigDecimal::compareTo)).thenComparing(recent);
            case "length" -> Comparator.comparingInt((Solution s) -> s.getSourceCode().getBytes(StandardCharsets.UTF_8).length).thenComparing(recent);
            default -> recent;
        };
    }
    public static BigDecimal memoryBytes(Solution s) {
        if (s.getMemoryValue() == null || s.getMemoryValue().signum() < 0 || s.getMemoryUnit() == null) return null;
        int scale = switch (s.getMemoryUnit()) { case "KB" -> 1000; case "KiB" -> 1024;
            case "MB" -> 1000000; case "MiB" -> 1048576; default -> 0; };
        return scale == 0 ? null : s.getMemoryValue().multiply(BigDecimal.valueOf(scale));
    }
}
