package com.codearchive.api.auth.oauth;

import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "auth_exchange_codes")
public class AuthExchangeCode {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "code_hash", nullable = false, unique = true, length = 64)
    private String codeHash;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "consumed_at")
    private Instant consumedAt;

    protected AuthExchangeCode() {
    }

    private AuthExchangeCode(
            UUID id,
            UUID userId,
            String codeHash,
            Instant expiresAt,
            Instant createdAt
    ) {
        this.id = id;
        this.userId = userId;
        this.codeHash = codeHash;
        this.expiresAt = expiresAt;
        this.createdAt = createdAt;
    }

    public static AuthExchangeCode create(
            UUID userId,
            String codeHash,
            Instant expiresAt,
            Instant createdAt
    ) {
        return new AuthExchangeCode(
                UUID.randomUUID(),
                userId,
                codeHash,
                expiresAt,
                createdAt
        );
    }

    public UUID getUserId() {
        return userId;
    }

    public String getCodeHash() {
        return codeHash;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }
}
