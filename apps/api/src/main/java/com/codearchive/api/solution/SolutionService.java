package com.codearchive.api.solution;

import com.codearchive.api.auth.AppUser;
import com.codearchive.api.auth.UserRepository;
import com.codearchive.api.settings.UserSettingsRepository;
import java.math.BigDecimal;
import java.net.URI;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SolutionService {

    private final com.codearchive.api.community.CommunityPublicationPolicy publication;
    private final UserRepository userRepository;
    private final SolutionRepository solutionRepository;
    private final UserSettingsRepository settingsRepository;

    public SolutionService(UserRepository userRepository, SolutionRepository solutionRepository, UserSettingsRepository settingsRepository, com.codearchive.api.community.CommunityPublicationPolicy publication) {
        this.publication = publication;
        this.userRepository = userRepository;
        this.solutionRepository = solutionRepository;
        this.settingsRepository = settingsRepository;
    }

    @Transactional(noRollbackFor = CaptureValidationException.class)
    public Solution upsert(String githubId, CapturePayload payload) {
        NormalizedCapture capture = normalize(payload);
        AppUser user = userRepository.findByGithubId(githubId)
                .orElseThrow(() -> new CaptureValidationException("Authenticated user no longer exists"));

        userRepository.lockForCommunityLimit(user.getId()).orElseThrow();
        Optional<Solution> existing = solutionRepository.findByUserIdAndCaptureId(user.getId(), capture.captureId());
        if (existing.isPresent()) {
            Solution solution = existing.get();
            if (!sameCoreData(solution, capture)) {
                throw new CaptureValidationException("captureId already exists with different solution data");
            }
            BigDecimal executionTime = capture.executionTime() == null || Boolean.TRUE.equals(payload.getMetadataPending()) && solution.getExecutionTime() != null
                    ? solution.getExecutionTime() : capture.executionTime();
            BigDecimal memoryUsage = capture.memoryUsage() == null || Boolean.TRUE.equals(payload.getMetadataPending()) && solution.getMemoryUsage() != null
                    ? solution.getMemoryUsage() : capture.memoryUsage();
            solution.update(capture.platform(), capture.problemNumber(), capture.title(), capture.problemUrl(),
                    capture.language(), capture.languageKey(), capture.sourceCode(), capture.result(), capture.observedAt(),
                    capture.solvedAt(), executionTime, memoryUsage);
            if (capture.memoryValue() != null && (!Boolean.TRUE.equals(payload.getMetadataPending()) || solution.getMemoryValue() == null)) solution.setMemoryMeasurement(capture.memoryValue(), capture.memoryUnit());
            solution.setDifficulty(capture.difficulty());
            return solutionRepository.saveAndFlush(solution);
        }

        if (capture.historicalSubmissionId() != null) {
            Optional<Solution> sameSubmission = solutionRepository.findByUserIdAndPlatformAndHistoricalSubmissionId(
                    user.getId(), capture.platform(), capture.historicalSubmissionId());
            if (sameSubmission.isPresent()) {
                Solution solution = sameSubmission.get();
                if (!solution.isHistoricalImport()
                        || !solution.getProblemNumber().equals(capture.problemNumber())
                        || !solution.getLanguageKey().equals(capture.languageKey())
                        || !solution.getSourceCode().equals(capture.sourceCode())
                        || !solution.getSolvedAt().equals(capture.solvedAt())) {
                    throw new CaptureValidationException("historicalSubmissionId already exists with different solution data");
                }
                solution.enrichVerifiedMetadata(capture.executionTime(), capture.memoryValue(), capture.memoryUnit(), capture.difficulty());
                return solution;
            }
        }

        Solution solution = new Solution(user, capture.captureId(), capture.platform(), capture.problemNumber(),
                capture.title(), capture.problemUrl(), capture.language(), capture.languageKey(), capture.sourceCode(), capture.result(),
                capture.observedAt(), capture.solvedAt(), capture.executionTime(), capture.memoryUsage());
        solution.setDifficulty(capture.difficulty());
        solution.setHistoricalImport(capture.historicalImport());
        solution.setHistoricalSubmissionId(capture.historicalSubmissionId());
        solution.setMemoryMeasurement(capture.memoryValue(), capture.memoryUnit());
        boolean publish = settingsRepository.findByUserId(user.getId())
                .map(com.codearchive.api.settings.UserSettings::isCommunityPublicByDefault).orElse(true);
        solution.setPublished(publish, Instant.now());
        solutionRepository.saveAndFlush(solution);
        if (publish) publication.applyProblem(user.getId(), solution.getPlatform(), solution.getProblemNumber(), settingsRepository.findByUserId(user.getId()).map(com.codearchive.api.settings.UserSettings::getCommunityDuplicateVisibility).orElse("all"));
        return solution;
    }

    public record ReconciliationPage(List<ReconciliationRecord> records, long cursor, boolean hasMore) { }
    @Transactional(readOnly = true)
    public ReconciliationPage reconciliationPage(String githubId, Platform platform, long cursor) {
        AppUser user = userRepository.findByGithubId(githubId).orElseThrow(() -> new CaptureValidationException("Authenticated user no longer exists"));
        var found = solutionRepository.findByUserIdAndPlatformAndIdGreaterThanOrderByIdAsc(user.getId(), platform, cursor, org.springframework.data.domain.PageRequest.of(0, 51));
        var records = found.stream().limit(50).map(ReconciliationRecord::from).toList();
        return new ReconciliationPage(records, records.isEmpty() ? cursor : records.get(records.size() - 1).recordId(), found.size() > 50);
    }

    @Transactional(readOnly = true)
    public List<Solution> listForUser(String githubId) {
        AppUser user = userRepository.findByGithubId(githubId)
                .orElseThrow(() -> new CaptureValidationException("Authenticated user no longer exists"));
        return solutionRepository.findByUserIdOrderBySolvedAtDesc(user.getId());
    }

    @Transactional(readOnly = true)
    public List<String> historicalSubmissionIdsForUser(String githubId, Platform platform) {
        AppUser user = userRepository.findByGithubId(githubId)
                .orElseThrow(() -> new CaptureValidationException("Authenticated user no longer exists"));
        return solutionRepository.findHistoricalSubmissionIds(user.getId(), platform);
    }

    private NormalizedCapture normalize(CapturePayload payload) {
        if (payload == null) {
            throw new CaptureValidationException("Capture must be an object");
        }

        String captureId = required(payload.getCaptureId(), "captureId", 36);
        try {
            UUID parsed = UUID.fromString(captureId);
            if (!parsed.toString().equalsIgnoreCase(captureId)) {
                throw new IllegalArgumentException("non-canonical UUID");
            }
            captureId = parsed.toString();
        } catch (IllegalArgumentException exception) {
            throw new CaptureValidationException("captureId must be a UUID");
        }

        String platformValue = required(payload.getPlatform(), "platform", 20).toUpperCase(Locale.ROOT);
        Platform platform;
        try {
            platform = Platform.valueOf(platformValue);
        } catch (IllegalArgumentException exception) {
            throw new CaptureValidationException("platform must be SWEA, PROGRAMMERS, or JUNGOL");
        }

        String problemNumber = required(payload.getProblemNumber(), "problemNumber", 100);
        String title = required(payload.getTitle(), "title", 500);
        String problemUrl = required(payload.getProblemUrl(), "problemUrl", 2048);
        validateUrl(problemUrl);
        String language = required(payload.getLanguage(), "language", 100);
        String languageKey = LanguageNormalizer.canonicalKey(language);
        if (payload.getLanguageKey() != null && !payload.getLanguageKey().trim().equals(languageKey)) {
            throw new CaptureValidationException("languageKey does not match language");
        }
        String sourceCode = requiredPreservingWhitespace(payload.getSourceCode(), "sourceCode", 1_000_000);
        String result = required(payload.getResult(), "result", 20);
        if (!"ACCEPTED".equalsIgnoreCase(result)) {
            throw new CaptureValidationException("result must be ACCEPTED");
        }
        result = "ACCEPTED";

        Instant observedAt = parseTimestamp(payload.getObservedAt(), "observedAt");
        Instant solvedAt = parseTimestamp(payload.getSolvedAt(), "solvedAt");
        validateMetric(payload.getExecutionTime(), "executionTime");
        validateMetric(payload.getMemoryUsage(), "memoryUsage");
        validateMetric(payload.getMemoryValue(), "memoryValue");
        String memoryUnit = normalizeMemoryUnit(payload.getMemoryUnit(), payload.getMemoryValue());
        String historicalSubmissionId = payload.getHistoricalSubmissionId();
        if (historicalSubmissionId != null &&
                (!Boolean.TRUE.equals(payload.getHistoricalImport()) || !validHistoricalIdentity(platform, historicalSubmissionId, problemNumber, solvedAt, languageKey))) {
            throw new CaptureValidationException("Invalid historical submission identity for platform");
        }

        return new NormalizedCapture(captureId, platform, problemNumber, title, problemUrl, language, languageKey, sourceCode,
                result, observedAt, solvedAt, payload.getExecutionTime(), payload.getMemoryUsage(), payload.getMemoryValue(), memoryUnit,
                Boolean.TRUE.equals(payload.getHistoricalImport()), historicalSubmissionId,
                ProblemDifficulty.validated(platform, problemNumber, problemUrl, payload.getDifficulty()));
    }

    private String required(String value, String field, int maxLength) {
        if (value == null || value.trim().isEmpty()) {
            throw new CaptureValidationException(field + " is required");
        }
        String normalized = value.trim();
        if (normalized.length() > maxLength) {
            throw new CaptureValidationException(field + " is too long");
        }
        return normalized;
    }

    private boolean validHistoricalIdentity(Platform platform, String id, String problemNumber, Instant solvedAt, String languageKey) {
        if (id.length() > 320) return false;
        return switch (platform) {
            case JUNGOL -> id.matches("[0-9]{1,40}");
            case SWEA -> id.matches("[A-Za-z0-9_-]{8,160}");
            case PROGRAMMERS -> {
                var match = java.util.regex.Pattern.compile("pg:[A-Za-z0-9_-]{1,100}:([0-9]{1,40}):([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}[+-][0-9]{2}:[0-9]{2}):([a-z0-9+.#-]{1,100})").matcher(id);
                if (!match.matches() || !problemNumber.equals(match.group(1)) || !languageKey.equals(match.group(3))) yield false;
                try { yield OffsetDateTime.parse(match.group(2)).toInstant().equals(solvedAt); }
                catch (DateTimeParseException exception) { yield false; }
            }
        };
    }

    private String requiredPreservingWhitespace(String value, String field, int maxLength) {
        if (value == null || value.trim().isEmpty()) {
            throw new CaptureValidationException(field + " is required");
        }
        if (value.length() > maxLength) {
            throw new CaptureValidationException(field + " is too long");
        }
        return value;
    }

    private void validateUrl(String value) {
        try {
            URI uri = URI.create(value);
            String scheme = uri.getScheme();
            if (scheme == null || !("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                    || uri.getHost() == null) {
                throw new IllegalArgumentException("unsupported URL");
            }
        } catch (IllegalArgumentException exception) {
            throw new CaptureValidationException("problemUrl must be an http(s) URL");
        }
    }

    private Instant parseTimestamp(String value, String field) {
        String normalized = required(value, field, 80);
        try {
            return Instant.parse(normalized);
        } catch (DateTimeParseException ignored) {
            try {
                return OffsetDateTime.parse(normalized).toInstant();
            } catch (DateTimeParseException exception) {
                throw new CaptureValidationException(field + " must be an ISO-8601 timestamp");
            }
        }
    }

    private void validateMetric(BigDecimal value, String field) {
        if (value != null && value.signum() < 0) {
            throw new CaptureValidationException(field + " cannot be negative");
        }
    }

    private String normalizeMemoryUnit(String value, BigDecimal memoryValue) {
        // A numeric measurement without a unit is deliberately not guessed.
        // Keeping UNKNOWN makes new rows distinguishable from KB/MB captures.
        if (value == null || value.isBlank()) return "UNKNOWN";
        String normalized = value.trim();
        String unit;
        if (normalized.equalsIgnoreCase("KB")) unit = "KB";
        else if (normalized.equalsIgnoreCase("KiB")) unit = "KiB";
        else if (normalized.equalsIgnoreCase("MB")) unit = "MB";
        else if (normalized.equalsIgnoreCase("MiB")) unit = "MiB";
        else if (normalized.equalsIgnoreCase("UNKNOWN")) unit = "UNKNOWN";
        else {
            throw new CaptureValidationException("memoryUnit must be KB, KiB, MB, MiB, or UNKNOWN");
        }
        if (memoryValue == null && !unit.equals("UNKNOWN")) throw new CaptureValidationException("memoryValue is required with memoryUnit");
        return unit;
    }

    private boolean sameCoreData(Solution solution, NormalizedCapture capture) {
        return solution.getPlatform() == capture.platform()
                && solution.getProblemNumber().equals(capture.problemNumber())
                && solution.getTitle().equals(capture.title())
                && solution.getProblemUrl().equals(capture.problemUrl())
                && solution.getLanguage().equals(capture.language())
                && solution.getLanguageKey().equals(capture.languageKey())
                && solution.getSourceCode().equals(capture.sourceCode())
                && solution.getResult().equals(capture.result())
                && solution.getObservedAt().equals(capture.observedAt())
                && solution.getSolvedAt().equals(capture.solvedAt())
                && solution.isHistoricalImport() == capture.historicalImport()
                && java.util.Objects.equals(solution.getHistoricalSubmissionId(), capture.historicalSubmissionId());
    }

    private record NormalizedCapture(String captureId, Platform platform, String problemNumber, String title,
                                     String problemUrl, String language, String languageKey, String sourceCode, String result,
                                     Instant observedAt, Instant solvedAt, BigDecimal executionTime,
                                     BigDecimal memoryUsage, BigDecimal memoryValue, String memoryUnit,
                                     boolean historicalImport, String historicalSubmissionId, ProblemDifficulty difficulty) {
    }
}
