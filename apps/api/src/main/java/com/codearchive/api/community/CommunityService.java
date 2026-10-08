package com.codearchive.api.community;

import com.codearchive.api.settings.UserSettings;
import com.codearchive.api.settings.UserSettingsRepository;
import com.codearchive.api.solution.Platform;
import com.codearchive.api.solution.Solution;
import com.codearchive.api.solution.SolutionRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.NoSuchElementException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CommunityService {
    private final SolutionRepository solutions;
    private final UserSettingsRepository settings;
    private final CommunityPublicationPolicy publication;
    private final CommunityStore store;
    private final com.codearchive.api.auth.UserRepository users;

    public CommunityService(SolutionRepository solutions, UserSettingsRepository settings, CommunityStore store,
                            com.codearchive.api.auth.UserRepository users, CommunityPublicationPolicy publication) {
        this.solutions = solutions;
        this.settings = settings;
        this.publication = publication;
        this.store = store;
        this.users = users;
    }

    @Transactional
    public VisibilityResponse setVisibility(long ownerId, long solutionId, boolean publish) {
        users.lockForCommunityLimit(ownerId).orElseThrow(NoSuchElementException::new);
        Solution solution = solutions.findByIdAndUserId(solutionId, ownerId)
                .orElseThrow(NoSuchElementException::new);
        if (publish && !"ACCEPTED".equals(solution.getResult())) throw new InvalidSolutionException();
        solution.setPublished(publish, Instant.now());
        solutions.saveAndFlush(solution);
        if (publish) publication.applyProblem(ownerId, solution.getPlatform(), solution.getProblemNumber(), policy(ownerId));
        return new VisibilityResponse(solution.isPublished() ? "published" : "private", solution.getPublishedAt());
    }

    @Transactional(readOnly = true)
    public SharedPage list(long viewerId, Platform platform, String problemNumber,
                           String languageKey, String sort, int page, int size) {
        store.requireEligibility(viewerId, platform, problemNumber);
        return store.list(viewerId, platform, problemNumber, languageKey, sort, page, size);
    }

    @Transactional
    public BulkVisibilityResponse publishAll(long ownerId) {
        users.lockForCommunityLimit(ownerId).orElseThrow(NoSuchElementException::new);
        var before = solutions.findByUserIdOrderBySolvedAtDesc(ownerId).stream().filter(Solution::isPublished)
            .map(Solution::getId).collect(java.util.stream.Collectors.toSet());
        publication.apply(ownerId, policy(ownerId), true);
        int changed = (int) solutions.findByUserIdOrderBySolvedAtDesc(ownerId).stream()
            .filter(s -> s.isPublished() && !before.contains(s.getId())).count();
        return new BulkVisibilityResponse(changed, solutions.findPublishedProblemsForOwner(ownerId).size(),
                solutions.countByUserIdAndResultAndPublishedAtIsNotNull(ownerId, "ACCEPTED"));
    }

    @Transactional(readOnly = true)
    public SharedSolution detail(long viewerId, long solutionId) {
        return solutions.findSharedDetail(viewerId, solutionId)
                .map(solution -> response(viewerId, solution)).orElseThrow(NoSuchElementException::new);
    }

    private SharedSolution response(long viewerId, Solution solution) {
        var stats = store.stats(viewerId, solution.getId());
        return new SharedSolution(solution.getId(), solution.getPlatform(), solution.getProblemNumber(),
                solution.getTitle(), solution.getProblemUrl(), solution.getLanguage(), solution.getLanguageKey(),
                solution.getSourceCode(), solution.getSolvedAt(), solution.getPublishedAt(),
                solution.getExecutionTime(), solution.getMemoryValue(), solution.getMemoryUnit(),
                author(solution), solution.getSourceCode().getBytes(java.nio.charset.StandardCharsets.UTF_8).length,
                solution.getUser().getId() == viewerId, stats.likeCount(), stats.commentCount(), stats.liked());
    }

    private String policy(long owner) { return settings.findByUserId(owner).map(UserSettings::getCommunityDuplicateVisibility).orElse("all"); }

    private PublicAuthor author(Solution solution) {
        var author = solution.getUser();
        UserSettings profile = settings.findByUserId(author.getId()).orElse(null);
        return new PublicAuthor(profile == null ? "닉네임 미설정" : profile.getCommunityNickname());
    }

    @Transactional
    public CommunityStore.Stats like(long viewer, long id, boolean liked) {
        // Same-account requests serialize across instances; the database unique key is a second guard.
        users.lockForCommunityLimit(viewer).orElseThrow(NoSuchElementException::new);
        return store.like(viewer, id, liked);
    }
    @Transactional(readOnly = true)
    public CommunityStore.CommentPage comments(long viewer, long id, int page, int size) {
        return store.comments(viewer, id, page, size);
    }
    @Transactional
    public void comment(long viewer, long id, Long commentId, String body, boolean delete) {
        users.lockForCommunityLimit(viewer).orElseThrow(NoSuchElementException::new);
        store.comment(viewer, id, commentId, body, delete);
    }

    public static final class NotEligibleException extends RuntimeException {}
    public static final class InvalidSolutionException extends RuntimeException {}
    public record VisibilityResponse(String visibility, Instant publishedAt) {}
    public record BulkVisibilityResponse(int changedSubmissions, int publishedProblems, long publishedSubmissions) {}
    public record PublicAuthor(String nickname) {}
    public record SharedSummary(Long id, Platform platform, String problemNumber, String title,
                                String language, String languageKey, Instant solvedAt,
                                Instant publishedAt, BigDecimal executionTime, BigDecimal memoryValue, String memoryUnit,
                                int codeLength, boolean mine, PublicAuthor author, long likeCount, long commentCount, boolean liked) {}
    public record SharedSolution(Long id, Platform platform, String problemNumber, String title,
                                 String problemUrl, String language, String languageKey, String sourceCode,
                                 Instant solvedAt, Instant publishedAt, BigDecimal executionTime,
                                 BigDecimal memoryValue, String memoryUnit, PublicAuthor author, int codeLength,
                                 boolean mine, long likeCount, long commentCount, boolean liked) {}
    public record SharedPage(List<SharedSummary> items, int page, int size, long total, boolean hasMore) {}
}
