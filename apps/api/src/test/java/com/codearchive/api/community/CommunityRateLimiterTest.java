package com.codearchive.api.community;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class CommunityRateLimiterTest {
    @Test void bucketMaintainsSeparateBudgetsAndResetsAfterOneMinute() {
        Instant start = Instant.parse("2026-01-01T00:00:00Z");
        CommunityRequestLimit bucket = new CommunityRequestLimit(1, start);
        for (int n = 0; n < 60; n++) assertTrue(bucket.consume(false, start));
        assertFalse(bucket.consume(false, start));
        for (int n = 0; n < 10; n++) assertTrue(bucket.consume(true, start));
        assertFalse(bucket.consume(true, start));
        assertTrue(bucket.consume(false, start.plusSeconds(60)));
        assertTrue(bucket.consume(true, start.plusSeconds(60)));
    }
}
