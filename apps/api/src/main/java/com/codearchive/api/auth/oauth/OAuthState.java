package com.codearchive.api.auth.oauth;

import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "oauth_states")
public class OAuthState {

    public enum FlowType {
        GENERIC,
        EXTENSION,
        DASHBOARD
    }

    @Id
    private UUID id;

    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "state_hash", nullable = false, unique = true, length = 64)
    private String stateHash;

    @Enumerated(EnumType.STRING)
    @Column(name = "flow_type", nullable = false, length = 16)
    private FlowType flowType;

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
            FlowType flowType,
            Instant expiresAt,
            Instant createdAt
    ) {
        this.id = id;
        this.stateHash = stateHash;
        this.flowType = flowType;
        this.expiresAt = expiresAt;
        this.createdAt = createdAt;
    }

    public static OAuthState create(
            String stateHash,
            Instant expiresAt,
            Instant createdAt
    ) {
        return create(
                stateHash,
                FlowType.GENERIC,
                expiresAt,
                createdAt
        );
    }

    public static OAuthState create(
            String stateHash,
            FlowType flowType,
            Instant expiresAt,
            Instant createdAt
    ) {
        return new OAuthState(
                UUID.randomUUID(),
                stateHash,
                flowType,
                expiresAt,
                createdAt
        );
    }

    public String getStateHash() {
        return stateHash;
    }

    public FlowType getFlowType() {
        return flowType;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }
}
