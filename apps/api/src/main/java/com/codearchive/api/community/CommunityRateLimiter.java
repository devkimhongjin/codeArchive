package com.codearchive.api.community;

import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.LongSupplier;
import org.springframework.stereotype.Component;

/** A bounded per-instance guard. A distributed quota is still needed before scaling out. */
@Component
public class CommunityRateLimiter {
    private static final long WINDOW_NANOS = Duration.ofMinutes(1).toNanos();
    private static final int MAX_USERS = 100_000;
    private final ConcurrentHashMap<Long, Window> windows = new ConcurrentHashMap<>();
    private final LongSupplier clock;

    public CommunityRateLimiter() { this(System::nanoTime); }
    CommunityRateLimiter(LongSupplier clock) { this.clock = clock; }

    public boolean allowRead(long userId) { return allow(userId, false); }
    public boolean allowWrite(long userId) { return allow(userId, true); }

    private boolean allow(long userId, boolean write) {
        long now = clock.getAsLong();
        if (windows.size() >= MAX_USERS && !windows.containsKey(userId)) {
            windows.entrySet().removeIf(entry -> now - entry.getValue().startedAt() >= WINDOW_NANOS);
            if (windows.size() >= MAX_USERS) return false;
        }
        AtomicBoolean accepted = new AtomicBoolean();
        windows.compute(userId, (id, previous) -> {
            Window current = previous == null || now - previous.startedAt() >= WINDOW_NANOS
                    ? new Window(now, 0, 0) : previous;
            if ((write && current.writes() >= 10) || (!write && current.reads() >= 60)) return current;
            accepted.set(true);
            return new Window(current.startedAt(), current.reads() + (write ? 0 : 1),
                    current.writes() + (write ? 1 : 0));
        });
        return accepted.get();
    }

    private record Window(long startedAt, int reads, int writes) {}
}
