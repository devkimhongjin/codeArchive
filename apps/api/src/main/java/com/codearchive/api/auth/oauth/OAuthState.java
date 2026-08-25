package com.codearchive.api.auth.oauth;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "oauth_states")
public class OAuthState {

    @Id
    private UUID id;

    @Column(name = "state_hash", nullable = false, unique = true, length = 64)
    private String stateHash;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "consumed_at")
    private Instant consumedAt;

    protected OAuthState() {
    }

    private OAuthState(
            UUID id,
            String stateHash,
            Instant expiresAt,
            Instant createdAt
    ) {
        this.id = id;
        this.stateHash = stateHash;
        this.expiresAt = expiresAt;
        this.createdAt = createdAt;
    }

    public static OAuthState create(
            String stateHash,
            Instant expiresAt,
            Instant createdAt
    ) {
        return new OAuthState(
                UUID.randomUUID(),
                stateHash,
                expiresAt,
                createdAt
        );
    }

    public String getStateHash() {
        return stateHash;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }
}
