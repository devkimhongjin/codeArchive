package com.codearchive.api.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.codearchive.api.auth.AppUser;
import com.codearchive.api.solution.Platform;
import com.codearchive.api.solution.Solution;
import java.math.BigDecimal;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class AiPromptAndCacheKeyTest {
    private static Solution solution(String source) {
        Instant now = Instant.parse("2026-11-06T00:00:00Z");
        return new Solution(AppUser.fromGithub("4242", "private-login", "Private Name", "private@example.com"),
                "11111111-1111-4111-8111-111111111111", Platform.SWEA, "1234", "삼색 칩", "https://swexpertacademy.com/",
                "Java", "class Main {}", "ACCEPTED", now, now, new BigDecimal("123.000"), null);
    }

    @Test void promptCarriesTheProblemAndCodeButNoAccountIdentity() {
        AiPromptTemplate.Prompt prompt = AiPromptTemplate.build(solution("class Main {}"));

        assertThat(prompt.version()).isEqualTo(AiPromptTemplate.VERSION);
        assertThat(prompt.input()).contains("SWEA", "#1234 삼색 칩", "Java", "실행 시간: 123 ms", "class Main {}");
        assertThat(prompt.instructions() + prompt.input()).doesNotContain("4242", "private-login", "Private Name", "private@example.com");
    }

    @Test void cacheKeyChangesWithEveryInputAndKeepsFieldBoundaries() {
        String base = AiReviewCacheKey.of("java", "class Main {}", "fake", "fake-review-1", "code-review-v1");

        assertThat(base).hasSize(64).isEqualTo(AiReviewCacheKey.of("java", "class Main {}", "fake", "fake-review-1", "code-review-v1"));
        assertThat(AiReviewCacheKey.of("python", "class Main {}", "fake", "fake-review-1", "code-review-v1")).isNotEqualTo(base);
        assertThat(AiReviewCacheKey.of("java", "class Main { }", "fake", "fake-review-1", "code-review-v1")).isNotEqualTo(base);
        assertThat(AiReviewCacheKey.of("java", "class Main {}", "fake", "fake-review-2", "code-review-v1")).isNotEqualTo(base);
        assertThat(AiReviewCacheKey.of("java", "class Main {}", "fake", "fake-review-1", "code-review-v2")).isNotEqualTo(base);
        assertThat(AiReviewCacheKey.of("ja", "vaclass Main {}", "fake", "fake-review-1", "code-review-v1")).isNotEqualTo(base);
    }
}
