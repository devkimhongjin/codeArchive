package com.codearchive.api.ai;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;

/** Model calls a user made on one Korean calendar day; cached answers do not count. */
@Entity
@Table(name = "ai_daily_usage")
public class AiDailyUsage {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(name = "user_id", nullable = false) private Long userId;
    @Column(name = "usage_date", nullable = false) private LocalDate usageDate;
    @Column(name = "request_count", nullable = false) private int requestCount;

    protected AiDailyUsage() {}

    AiDailyUsage(long userId, LocalDate usageDate) {
        this.userId = userId;
        this.usageDate = usageDate;
    }

    public int getRequestCount() { return requestCount; }

    boolean consume(int limit) {
        if (requestCount >= limit) return false;
        requestCount++;
        return true;
    }
}
