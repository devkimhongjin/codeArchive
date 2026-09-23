package com.codearchive.api.community;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class CommunityRateLimiterTest {
    @Test void readsAndWritesHaveIndependentPerUserMinuteBudgets() {
        AtomicLong time = new AtomicLong(1_000);
        CommunityRateLimiter limiter = new CommunityRateLimiter(time::get);
        for (int n = 0; n < 60; n++) assertTrue(limiter.allowRead(1));
        assertFalse(limiter.allowRead(1));
        for (int n = 0; n < 10; n++) assertTrue(limiter.allowWrite(1));
        assertFalse(limiter.allowWrite(1));
        assertTrue(limiter.allowRead(2));
        assertTrue(limiter.allowWrite(2));
        time.addAndGet(60_000_000_000L);
        assertTrue(limiter.allowRead(1));
        assertTrue(limiter.allowWrite(1));
    }
}
