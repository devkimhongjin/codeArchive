package com.codearchive.api.community;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "community_request_limits")
public class CommunityRequestLimit {
    @Id
    @Column(name = "user_id")
    private Long userId;

    @Column(name = "window_start", nullable = false)
    private Instant windowStart;

    @Column(name = "read_count", nullable = false)
    private int readCount;

    @Column(name = "write_count", nullable = false)
    private int writeCount;

    protected CommunityRequestLimit() {}

    public CommunityRequestLimit(long userId, Instant now) {
        this.userId = userId;
        this.windowStart = now;
    }

    public boolean consume(boolean write, Instant now) {
        if (!now.isBefore(windowStart.plusSeconds(60))) {
            windowStart = now;
            readCount = 0;
            writeCount = 0;
        }
        if (write) {
            if (writeCount >= 10) return false;
            writeCount++;
        } else {
            if (readCount >= 60) return false;
            readCount++;
        }
        return true;
    }
}
