package com.codearchive.api.ai;

import com.codearchive.api.auth.UserRepository;
import java.time.LocalDate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Per-user daily model calls. The account row lock makes each decision atomic across API instances. */
@Service
public class AiQuota {
    private final UserRepository users;
    private final AiDailyUsageRepository usage;

    public AiQuota(UserRepository users, AiDailyUsageRepository usage) {
        this.users = users;
        this.usage = usage;
    }

    @Transactional
    public boolean consume(long userId, LocalDate day, int limit) {
        if (users.lockForCommunityLimit(userId).isEmpty()) return false;
        AiDailyUsage row = usage.findByUserIdAndUsageDate(userId, day).orElseGet(() -> new AiDailyUsage(userId, day));
        if (!row.consume(limit)) return false;
        usage.saveAndFlush(row);
        return true;
    }

    @Transactional(readOnly = true)
    public int used(long userId, LocalDate day) {
        return usage.findByUserIdAndUsageDate(userId, day).map(AiDailyUsage::getRequestCount).orElse(0);
    }
}
