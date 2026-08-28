package com.codearchive.api.auth.oauth;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface AuthExchangeCodeRepository
        extends JpaRepository<AuthExchangeCode, UUID> {

    Optional<AuthExchangeCode> findByCodeHash(String codeHash);

    @Modifying
    @Transactional
    @Query("update AuthExchangeCode exchangeCode "
            + "set exchangeCode.consumedAt = :now "
            + "where exchangeCode.codeHash = :codeHash "
            + "and exchangeCode.consumedAt is null "
            + "and exchangeCode.expiresAt > :now")
    int consumeActive(
            @Param("codeHash") String codeHash,
            @Param("now") Instant now
    );
}
