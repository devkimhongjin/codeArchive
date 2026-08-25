package com.codearchive.api.auth.user;

import java.time.Instant;
import java.util.UUID;

import com.codearchive.api.auth.oauth.GitHubUserProfile;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "users")
public class CodeArchiveUser {

    @Id
    private UUID id;

    @Column(name = "github_user_id", nullable = false, unique = true)
    private long githubUserId;

    @Column(name = "github_login", nullable = false)
    private String githubLogin;

    @Column(name = "display_name")
    private String displayName;

    @Column(name = "avatar_url", length = 2048)
    private String avatarUrl;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected CodeArchiveUser() {
    }

    private CodeArchiveUser(
            UUID id,
            GitHubUserProfile profile,
            Instant now
    ) {
        this.id = id;
        this.githubUserId = profile.githubUserId();
        this.githubLogin = profile.githubLogin();
        this.displayName = profile.displayName();
        this.avatarUrl = profile.avatarUrl();
        this.createdAt = now;
        this.updatedAt = now;
    }

    public static CodeArchiveUser create(
            GitHubUserProfile profile,
            Instant now
    ) {
        return new CodeArchiveUser(
                UUID.randomUUID(),
                profile,
                now
        );
    }

    public void refresh(
            GitHubUserProfile profile,
            Instant now
    ) {
        this.githubLogin = profile.githubLogin();
        this.displayName = profile.displayName();
        this.avatarUrl = profile.avatarUrl();
        this.updatedAt = now;
    }

    public UUID getId() {
        return id;
    }

    public long getGithubUserId() {
        return githubUserId;
    }

    public String getGithubLogin() {
        return githubLogin;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getAvatarUrl() {
        return avatarUrl;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
