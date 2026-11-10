package com.codearchive.api.ai;

import com.codearchive.api.auth.AppUser;
import com.codearchive.api.solution.LanguageNormalizer;
import com.codearchive.api.solution.Solution;
import com.codearchive.api.solution.SolutionRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI code review of one accepted solution (#251). A user's code reaches a
 * provider only when the operator switch is on, a provider is configured, the
 * user agreed to the current notice, the code is within the size limit, no
 * cached review exists and the daily limit allows one more call.
 */
@Service
public class AiReviewService {
    /** Bump when the notice shown before consent changes; older consents must be given again. */
    public static final String NOTICE_VERSION = "2026-11-06";
    private static final ZoneId DAY_ZONE = ZoneId.of("Asia/Seoul");
    private static final int MAX_SUMMARY = 2000, MAX_SUGGESTIONS = 8, MAX_SUGGESTION = 1000;
    private static final TypeReference<List<String>> SUGGESTIONS = new TypeReference<>() {};

    public enum Failure {
        AI_DISABLED(503), CONSENT_REQUIRED(409), NOT_FOUND(404), SOURCE_TOO_LARGE(413),
        DAILY_LIMIT_REACHED(429), SAFETY_BLOCKED(422), PROVIDER_TIMEOUT(504), PROVIDER_FAILED(502);

        private final int status;
        Failure(int status) { this.status = status; }
        public int status() { return status; }
    }

    public static final class AiReviewException extends RuntimeException {
        private final Failure failure;
        AiReviewException(Failure failure) {
            super(failure.name());
            this.failure = failure;
        }
        public Failure failure() { return failure; }
    }

    public record Status(boolean enabled, String provider, String model, int dailyLimit, int usedToday,
                         boolean consentGranted, String noticeVersion, int maxSourceBytes) {}

    public record Review(String captureId, String provider, String model, String promptVersion, String summary,
                         List<String> suggestions, Instant createdAt, boolean cached) {}

    private final AiSettings settings;
    private final ObjectProvider<AiReviewProvider> providers;
    private final AiConsentRepository consents;
    private final AiReviewRepository reviews;
    private final AiQuota quota;
    private final SolutionRepository solutions;
    private final ObjectMapper json;

    public AiReviewService(AiSettings settings, ObjectProvider<AiReviewProvider> providers, AiConsentRepository consents,
                           AiReviewRepository reviews, AiQuota quota, SolutionRepository solutions, ObjectMapper json) {
        this.settings = settings; this.providers = providers; this.consents = consents; this.reviews = reviews;
        this.quota = quota; this.solutions = solutions; this.json = json;
    }

    public Status status(AppUser user) {
        AiReviewProvider provider = provider();
        return new Status(provider != null, provider == null ? null : provider.name(), provider == null ? null : provider.model(),
                settings.dailyLimit(), quota.used(user.getId(), today()), consentGranted(user), NOTICE_VERSION, settings.maxSourceBytes());
    }

    @Transactional
    public Status consent(AppUser user, String noticeVersion) {
        if (!NOTICE_VERSION.equals(noticeVersion)) throw new IllegalArgumentException("AI notice changed");
        Instant now = Instant.now();
        consents.findById(user.getId()).ifPresentOrElse(existing -> existing.renew(NOTICE_VERSION, now),
                () -> consents.save(new AiConsent(user.getId(), NOTICE_VERSION, now)));
        return status(user);
    }

    /** Withdrawing consent also deletes every stored review of the user's code. */
    @Transactional
    public Status revoke(AppUser user) {
        consents.deleteById(user.getId());
        reviews.deleteByUser(user.getId());
        return status(user);
    }

    public Optional<Review> cached(AppUser user, String captureId) {
        AiReviewProvider provider = provider();
        Solution solution = solution(user, captureId);
        if (provider == null) return Optional.empty();
        return reviews.findByUserIdAndCacheKey(user.getId(), cacheKey(solution, provider)).map(review -> view(captureId, review, true));
    }

    public Review request(AppUser user, String captureId) {
        AiReviewProvider provider = provider();
        if (provider == null) throw new AiReviewException(Failure.AI_DISABLED);
        if (!consentGranted(user)) throw new AiReviewException(Failure.CONSENT_REQUIRED);
        Solution solution = solution(user, captureId);
        if (solution.getSourceCode().getBytes(StandardCharsets.UTF_8).length > settings.maxSourceBytes()) {
            throw new AiReviewException(Failure.SOURCE_TOO_LARGE);
        }
        String key = cacheKey(solution, provider);
        Optional<AiReview> stored = reviews.findByUserIdAndCacheKey(user.getId(), key);
        if (stored.isPresent()) return view(captureId, stored.get(), true);
        // The call is counted before it is made, so a timeout or failure still uses one.
        if (!quota.consume(user.getId(), today(), settings.dailyLimit())) throw new AiReviewException(Failure.DAILY_LIMIT_REACHED);

        AiReviewProvider.Result result;
        try {
            result = provider.review(AiPromptTemplate.build(solution), settings.timeout());
        } catch (AiReviewProvider.ProviderException e) {
            throw new AiReviewException(e.timedOut() ? Failure.PROVIDER_TIMEOUT : Failure.PROVIDER_FAILED);
        } catch (RuntimeException e) {
            throw new AiReviewException(Failure.PROVIDER_FAILED);
        }
        if (result == null) throw new AiReviewException(Failure.PROVIDER_FAILED);
        if (result.blocked()) throw new AiReviewException(Failure.SAFETY_BLOCKED);
        String summary = clip(result.summary(), MAX_SUMMARY);
        List<String> suggestions = result.suggestions() == null ? List.of() : result.suggestions().stream()
                .map(value -> clip(value, MAX_SUGGESTION)).filter(value -> !value.isEmpty()).limit(MAX_SUGGESTIONS).toList();
        if (summary.isEmpty() && suggestions.isEmpty()) throw new AiReviewException(Failure.PROVIDER_FAILED);

        AiReview review = new AiReview(user.getId(), solution.getId(), key, provider.name(), provider.model(),
                AiPromptTemplate.VERSION, summary, write(suggestions), Instant.now());
        try {
            reviews.saveAndFlush(review);
        } catch (DataIntegrityViolationException raced) {
            // A concurrent request stored the same review first; serve that one.
            return reviews.findByUserIdAndCacheKey(user.getId(), key).map(existing -> view(captureId, existing, true)).orElseThrow(() -> raced);
        }
        return view(captureId, review, false);
    }

    private AiReviewProvider provider() {
        return settings.enabled() ? providers.getIfAvailable() : null;
    }

    private boolean consentGranted(AppUser user) {
        return consents.findById(user.getId()).map(consent -> NOTICE_VERSION.equals(consent.getNoticeVersion())).orElse(false);
    }

    private Solution solution(AppUser user, String captureId) {
        return solutions.findByUserIdAndCaptureId(user.getId(), captureId).orElseThrow(() -> new AiReviewException(Failure.NOT_FOUND));
    }

    private static String cacheKey(Solution solution, AiReviewProvider provider) {
        String language = solution.getLanguageKey() != null ? solution.getLanguageKey() : LanguageNormalizer.canonicalKey(solution.getLanguage());
        return AiReviewCacheKey.of(language, solution.getSourceCode(), provider.name(), provider.model(), AiPromptTemplate.VERSION);
    }

    private static LocalDate today() {
        return LocalDate.now(DAY_ZONE);
    }

    private static String clip(String value, int max) {
        if (value == null) return "";
        String trimmed = value.strip();
        return trimmed.length() <= max ? trimmed : trimmed.substring(0, max);
    }

    private Review view(String captureId, AiReview review, boolean cached) {
        return new Review(captureId, review.getProvider(), review.getModel(), review.getPromptVersion(), review.getSummary(),
                read(review.getSuggestions()), review.getCreatedAt(), cached);
    }

    private String write(List<String> suggestions) {
        try {
            return json.writeValueAsString(suggestions);
        } catch (JsonProcessingException impossible) {
            throw new IllegalStateException("suggestions are not serializable", impossible);
        }
    }

    private List<String> read(String suggestions) {
        try {
            return json.readValue(suggestions, SUGGESTIONS);
        } catch (JsonProcessingException corrupt) {
            return List.of();
        }
    }
}
