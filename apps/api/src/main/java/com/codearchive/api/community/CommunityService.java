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
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CommunityService {
    private final SolutionRepository solutions;
    private final UserSettingsRepository settings;

    public CommunityService(SolutionRepository solutions, UserSettingsRepository settings) {
        this.solutions = solutions;
        this.settings = settings;
    }

    @Transactional
    public VisibilityResponse setVisibility(long ownerId, long solutionId, boolean publish) {
        Solution solution = solutions.findByIdAndUserId(solutionId, ownerId)
                .orElseThrow(NoSuchElementException::new);
        if (publish && !"ACCEPTED".equals(solution.getResult())) throw new InvalidSolutionException();
        solution.setPublished(publish, Instant.now());
        solutions.saveAndFlush(solution);
        return new VisibilityResponse(solution.isPublished() ? "published" : "private", solution.getPublishedAt());
    }

    @Transactional(readOnly = true)
    public SharedPage list(long viewerId, Platform platform, String problemNumber,
                           String languageKey, int page, int size) {
        if (!solutions.existsByUserIdAndPlatformAndProblemNumberAndPublishedAtIsNotNull(
                viewerId, platform, problemNumber)) {
            throw new NotEligibleException();
        }
        // The query repeats the eligibility predicate: a concurrent unpublish
        // cannot expose another user's code between the check and this read.
        PageRequest paging = PageRequest.of(page, size,
                Sort.by(Sort.Order.desc("publishedAt"), Sort.Order.desc("id")));
        Page<Solution> result = languageKey == null
                ? solutions.findSharedForProblem(viewerId, platform, problemNumber, paging)
                : solutions.findSharedForProblemByLanguage(viewerId, platform, problemNumber, languageKey, paging);
        List<SharedSummary> items = result.getContent().stream().map(this::summary).toList();
        return new SharedPage(items, page, size, result.getTotalElements(), result.hasNext());
    }

    @Transactional(readOnly = true)
    public SharedSolution detail(long viewerId, long solutionId) {
        return solutions.findSharedDetail(viewerId, solutionId)
                .map(this::response).orElseThrow(NoSuchElementException::new);
    }

    private SharedSolution response(Solution solution) {
        return new SharedSolution(solution.getId(), solution.getPlatform(), solution.getProblemNumber(),
                solution.getTitle(), solution.getProblemUrl(), solution.getLanguage(), solution.getLanguageKey(),
                solution.getSourceCode(), solution.getSolvedAt(), solution.getPublishedAt(),
                solution.getExecutionTime(), solution.getMemoryValue(), solution.getMemoryUnit(),
                author(solution));
    }

    private SharedSummary summary(Solution solution) {
        return new SharedSummary(solution.getId(), solution.getPlatform(), solution.getProblemNumber(),
                solution.getTitle(), solution.getLanguage(), solution.getLanguageKey(),
                solution.getSolvedAt(), solution.getPublishedAt(), author(solution));
    }

    private PublicAuthor author(Solution solution) {
        var author = solution.getUser();
        UserSettings profile = settings.findByUserId(author.getId()).orElse(null);
        String displayName = profile == null ? null : profile.getDisplayName();
        String nickname = profile == null ? null : profile.getNickname();
        if (displayName == null || displayName.isBlank()) displayName = "CodeArchive 사용자";
        return new PublicAuthor(displayName, nickname, author.getGithubAvatarUrl());
    }

    public static final class NotEligibleException extends RuntimeException {}
    public static final class InvalidSolutionException extends RuntimeException {}
    public record VisibilityResponse(String visibility, Instant publishedAt) {}
    public record PublicAuthor(String name, String nickname, String avatarUrl) {}
    public record SharedSummary(Long id, Platform platform, String problemNumber, String title,
                                String language, String languageKey, Instant solvedAt,
                                Instant publishedAt, PublicAuthor author) {}
    public record SharedSolution(Long id, Platform platform, String problemNumber, String title,
                                 String problemUrl, String language, String languageKey, String sourceCode,
                                 Instant solvedAt, Instant publishedAt, BigDecimal executionTime,
                                 BigDecimal memoryValue, String memoryUnit, PublicAuthor author) {}
    public record SharedPage(List<SharedSummary> items, int page, int size, long total, boolean hasMore) {}
}
