package com.codearchive.api.ai;

import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Operator switches for AI code review. Everything stays off until an operator
 * sets {@code codearchive.ai.enabled}; that flag is also the global kill switch.
 */
@Component
public class AiSettings {
    private final boolean enabled;
    private final int dailyLimit;
    private final int maxSourceBytes;
    private final Duration timeout;

    public AiSettings(@Value("${codearchive.ai.enabled:false}") boolean enabled,
                      @Value("${codearchive.ai.daily-limit:5}") int dailyLimit,
                      @Value("${codearchive.ai.max-source-bytes:20000}") int maxSourceBytes,
                      @Value("${codearchive.ai.timeout-ms:20000}") long timeoutMs) {
        this.enabled = enabled;
        this.dailyLimit = Math.max(0, Math.min(dailyLimit, 100));
        this.maxSourceBytes = Math.max(1, Math.min(maxSourceBytes, 100_000));
        this.timeout = Duration.ofMillis(Math.max(1_000, Math.min(timeoutMs, 60_000)));
    }

    public boolean enabled() { return enabled; }
    public int dailyLimit() { return dailyLimit; }
    public int maxSourceBytes() { return maxSourceBytes; }
    public Duration timeout() { return timeout; }
}
