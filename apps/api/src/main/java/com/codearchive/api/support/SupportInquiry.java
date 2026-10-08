package com.codearchive.api.support;

import com.codearchive.api.auth.AppUser;
import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "support_inquiries")
public class SupportInquiry {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @ManyToOne(optional = false, fetch = FetchType.LAZY) @JoinColumn(name = "owner_id") private AppUser owner;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private SupportCategory category;
    @Column(nullable = false, length = 150) private String title;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private SupportStatus status;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Column(name = "closed_at") private Instant closedAt;
    @Version private long version;
    protected SupportInquiry() {}
    SupportInquiry(AppUser owner, SupportCategory category, String title, Instant now) {
        this.owner = owner; this.category = category; this.title = title; this.status = SupportStatus.OPEN;
        this.createdAt = now; this.updatedAt = now;
    }
    public Long getId() { return id; } public AppUser getOwner() { return owner; }
    public SupportCategory getCategory() { return category; } public String getTitle() { return title; }
    public SupportStatus getStatus() { return status; } public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; } public Instant getClosedAt() { return closedAt; }
    void replyByOwner(Instant now) { status = SupportStatus.OPEN; closedAt = null; updatedAt = now; }
    void replyByAdmin(boolean close, Instant now) { status = close ? SupportStatus.CLOSED : SupportStatus.ANSWERED; closedAt = close ? now : null; updatedAt = now; }
    void setStatus(SupportStatus next, Instant now) { status = next; closedAt = next == SupportStatus.CLOSED ? now : null; updatedAt = now; }
}
