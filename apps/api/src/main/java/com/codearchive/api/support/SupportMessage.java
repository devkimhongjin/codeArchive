package com.codearchive.api.support;

import com.codearchive.api.auth.AppUser;
import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "support_messages")
public class SupportMessage {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @ManyToOne(optional = false, fetch = FetchType.LAZY) @JoinColumn(name = "inquiry_id") private SupportInquiry inquiry;
    @ManyToOne(optional = false, fetch = FetchType.LAZY) @JoinColumn(name = "author_id") private AppUser author;
    @Enumerated(EnumType.STRING) @Column(name = "author_role", nullable = false, length = 10) private SupportAuthorRole authorRole;
    @Column(nullable = false, length = 10000) private String body;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    protected SupportMessage() {}
    SupportMessage(SupportInquiry inquiry, AppUser author, SupportAuthorRole authorRole, String body, Instant now) {
        this.inquiry = inquiry; this.author = author; this.authorRole = authorRole; this.body = body; this.createdAt = now;
    }
    public Long getId() { return id; } public SupportAuthorRole getAuthorRole() { return authorRole; }
    public String getBody() { return body; } public Instant getCreatedAt() { return createdAt; }
    void updateAnswer(String body) { this.body = body; }
}
