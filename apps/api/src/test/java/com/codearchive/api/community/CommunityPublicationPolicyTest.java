package com.codearchive.api.community;

import static org.assertj.core.api.Assertions.assertThat;
import com.codearchive.api.auth.AppUser;
import com.codearchive.api.solution.Platform;
import com.codearchive.api.solution.Solution;
import java.math.BigDecimal;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class CommunityPublicationPolicyTest {
    @Test void invalidLegacyMeasurementsNeverBeatValidOnes() {
        Solution invalid = solution("-1", "2026-01-02T00:00:00Z");
        Solution valid = solution("10", "2026-01-01T00:00:00Z");
        assertThat(CommunityPublicationPolicy.comparator("execution").compare(valid, invalid)).isNegative();
        invalid.setMemoryMeasurement(new BigDecimal("1"), "UNKNOWN");
        valid.setMemoryMeasurement(new BigDecimal("2"), "MB");
        assertThat(CommunityPublicationPolicy.comparator("memory").compare(valid, invalid)).isNegative();
        invalid.setMemoryMeasurement(new BigDecimal("-1"), "KB");
        assertThat(CommunityPublicationPolicy.memoryBytes(invalid)).isNull();
    }
    private Solution solution(String time, String submitted) {
        return new Solution(AppUser.fromGithub("1", "fixture", null, null), "fixture", Platform.SWEA, "1", "Fixture",
            "https://example.test", "Java", "한", "ACCEPTED", Instant.parse(submitted), Instant.parse(submitted), new BigDecimal(time), null);
    }
}
