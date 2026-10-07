package com.codearchive.api.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "desktop_login_requests")
public class DesktopLoginRequest {
    @Id @Column(length = 64) private String id;
    @Column(nullable = false, length = 43) private String challenge;
    @Column(name = "client_key", nullable = false, length = 64) private String clientKey;
    @Column(name = "expires_at", nullable = false) private Instant expiresAt;
    @Column(nullable = false) private boolean bound;
    @Column(name = "github_id", length = 64) private String githubId;
    protected DesktopLoginRequest() {}
    DesktopLoginRequest(String id, String challenge, String clientKey, Instant expiresAt) {
        this.id = id; this.challenge = challenge; this.clientKey = clientKey; this.expiresAt = expiresAt;
    }
    String challenge() { return challenge; }
    Instant expiresAt() { return expiresAt; }
    boolean bound() { return bound; }
    void bind() { bound = true; }
    String githubId() { return githubId; }
    void approve(String value) { githubId = value; }
}
