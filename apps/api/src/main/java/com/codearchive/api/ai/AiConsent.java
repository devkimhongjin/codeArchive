package com.codearchive.api.ai;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** The notice version a user agreed to before any of their code may reach a model. */
@Entity
@Table(name = "ai_consents")
public class AiConsent {
    @Id
    @Column(name = "user_id")
    private Long userId;

    @Column(name = "notice_version", nullable = false, length = 40)
    private String noticeVersion;

    @Column(name = "granted_at", nullable = false)
    private Instant grantedAt;

    protected AiConsent() {}

    AiConsent(long userId, String noticeVersion, Instant grantedAt) {
        this.userId = userId;
        this.noticeVersion = noticeVersion;
        this.grantedAt = grantedAt;
    }

    public String getNoticeVersion() { return noticeVersion; }
    public Instant getGrantedAt() { return grantedAt; }

    void renew(String noticeVersion, Instant grantedAt) {
        this.noticeVersion = noticeVersion;
        this.grantedAt = grantedAt;
    }
}
