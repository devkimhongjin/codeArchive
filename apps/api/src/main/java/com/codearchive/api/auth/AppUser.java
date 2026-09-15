package com.codearchive.api.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "users")
public class AppUser {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Legacy email column.  It is deliberately nullable for new GitHub users:
     * GitHub does not guarantee that the profile email is available, and an
     * email address is never used as an account identity.
     */
    @Column(nullable = true, unique = true, length = 320)
    private String email;

    /** Legacy password hash retained for rows created before GitHub login. */
    @Column(name = "password_hash", nullable = true, length = 100)
    private String passwordHash;

    /** Immutable GitHub numeric account id, stored as text to preserve it exactly. */
    @Column(name = "github_id", unique = true, length = 64)
    private String githubId;

    @Column(name = "github_login", length = 39)
    private String githubLogin;

    @Column(name = "github_name", length = 255)
    private String githubName;

    /** GitHub's profile email, which may be absent and is never used for lookup. */
    @Column(name = "github_email", length = 320)
    private String githubEmail;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected AppUser() {
    }

    public AppUser(String email, String passwordHash) {
        this.email = email;
        this.passwordHash = passwordHash;
        this.createdAt = Instant.now();
    }

    private AppUser(String githubId, String githubLogin, String githubName, String githubEmail,
                    boolean githubAccount) {
        this.githubId = githubId;
        this.githubLogin = githubLogin;
        this.githubName = githubName;
        this.githubEmail = githubEmail;
        this.createdAt = Instant.now();
    }

    public static AppUser fromGithub(String githubId, String githubLogin, String githubName, String githubEmail) {
        return new AppUser(githubId, githubLogin, githubName, githubEmail, true);
    }

    public Long getId() {
        return id;
    }

    public String getEmail() {
        return email;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public String getGithubId() {
        return githubId;
    }

    public String getGithubLogin() {
        return githubLogin;
    }

    public String getGithubName() {
        return githubName;
    }

    public String getGithubEmail() {
        return githubEmail;
    }

    /**
     * Refresh mutable profile fields after a successful GitHub login.  There
     * is intentionally no githubId setter: account identity is immutable.
     */
    public void updateGithubProfile(String githubLogin, String githubName, String githubEmail) {
        this.githubLogin = githubLogin;
        this.githubName = githubName;
        this.githubEmail = githubEmail;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
