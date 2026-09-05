package com.codearchive.api.auth.session;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface AuthSessionRepository
        extends JpaRepository<AuthSession, UUID> {

    @Query("select authSession from AuthSession authSession "
            + "where authSession.tokenHash = :tokenHash "
            + "and authSession.revokedAt is null "
            + "and authSession.expiresAt > :now")
    Optional<AuthSession> findActiveByTokenHash(
            @Param("tokenHash") String tokenHash,
            @Param("now") Instant now
    );

    @Modifying
    @Transactional
    @Query("update AuthSession authSession "
            + "set authSession.revokedAt = :now "
            + "where authSession.id = :sessionId "
            + "and authSession.revokedAt is null")
    int revoke(
            @Param("sessionId") UUID sessionId,
            @Param("now") Instant now
    );

    @Modifying
    @Transactional
    @Query("update AuthSession authSession "
            + "set authSession.revokedAt = :now "
            + "where authSession.userId = :userId "
            + "and authSession.revokedAt is null "
            + "and authSession.expiresAt > :now")
    int revokeActiveForUser(
            @Param("userId") UUID userId,
            @Param("now") Instant now
    );
}
