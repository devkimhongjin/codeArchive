package com.codearchive.api.auth.oauth;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface OAuthStateRepository
        extends JpaRepository<OAuthState, UUID> {

    Optional<OAuthState> findByStateHash(String stateHash);

    @Modifying
    @Transactional
    @Query("update OAuthState oauthState "
            + "set oauthState.consumedAt = :now "
            + "where oauthState.stateHash = :stateHash "
            + "and oauthState.consumedAt is null "
            + "and oauthState.expiresAt > :now")
    int consumeActive(
            @Param("stateHash") String stateHash,
            @Param("now") Instant now
    );
}
