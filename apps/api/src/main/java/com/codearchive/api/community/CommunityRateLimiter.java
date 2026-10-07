package com.codearchive.api.community;

import com.codearchive.api.auth.UserRepository;
import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** One account-row lock makes each quota decision atomic across API instances. */
@Service
public class CommunityRateLimiter {
    private final UserRepository users;
    private final CommunityRequestLimitRepository limits;

    public CommunityRateLimiter(UserRepository users, CommunityRequestLimitRepository limits) {
        this.users = users;
        this.limits = limits;
    }

    @Transactional
    public boolean allowRead(long userId) { return consume(userId, false); }

    @Transactional
    public boolean allowWrite(long userId) { return consume(userId, true); }

    private boolean consume(long userId, boolean write) {
        // The account row exists before the first quota row, so this lock also
        // serializes concurrent first requests without a duplicate insert race.
        if (users.lockForCommunityLimit(userId).isEmpty()) return false;
        Instant now = Instant.now();
        CommunityRequestLimit bucket = limits.findById(userId)
                .orElseGet(() -> new CommunityRequestLimit(userId, now));
        if (!bucket.consume(write, now)) return false;
        limits.saveAndFlush(bucket);
        return true;
    }
}
