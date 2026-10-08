package com.codearchive.api.support;

import com.codearchive.api.auth.AppUser;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Objects;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SupportService {
    public static final int CLOSED_RETENTION_DAYS = 90;
    private final SupportInquiryRepository inquiries;
    private final SupportMessageRepository messages;
    public SupportService(SupportInquiryRepository inquiries, SupportMessageRepository messages) { this.inquiries = inquiries; this.messages = messages; }
    @Transactional public void purgeExpired() {
        Instant cutoff = Instant.now().minus(CLOSED_RETENTION_DAYS, ChronoUnit.DAYS);
        var expired = inquiries.lockClosedBefore(cutoff);
        if (expired.isEmpty()) return;
        var ids = expired.stream().map(SupportInquiry::getId).toList();
        // Row locks make a concurrent follow-up wait. It either reopens before
        // this query (and is excluded) or observes a deleted inquiry afterwards.
        messages.deleteByInquiryIdIn(ids);
        messages.flush();
        inquiries.deleteAll(expired);
    }
    @Transactional public InquiryView create(AppUser owner, SupportCategory category, String title, String body) {
        Instant now = Instant.now(); SupportInquiry inquiry = inquiries.save(new SupportInquiry(owner, category, title, now));
        messages.save(new SupportMessage(inquiry, owner, SupportAuthorRole.USER, body, now)); return detail(inquiry, false);
    }
    @Transactional(readOnly = true) public PageView mine(long ownerId, int page) { var result = inquiries.findByOwnerIdOrderByUpdatedAtDescIdDesc(ownerId, PageRequest.of(page, 20)); return page(result); }
    @Transactional(readOnly = true) public PageView all(int page) { var result = inquiries.findAllByOrderByUpdatedAtDescIdDesc(PageRequest.of(page, 20)); return page(result); }
    @Transactional(readOnly = true) public InquiryView mineDetail(long ownerId, long id) { return detail(inquiries.findByIdAndOwnerId(id, ownerId).orElseThrow(NoSuchElementException::new), false); }
    @Transactional(readOnly = true) public InquiryView adminDetail(long id) { return detail(inquiries.findById(id).orElseThrow(NoSuchElementException::new), true); }
    @Transactional public InquiryView reply(AppUser actor, boolean admin, long id, String body, boolean close) {
        SupportInquiry inquiry = inquiries.lockById(id).orElseThrow(NoSuchElementException::new);
        if (!admin && !Objects.equals(inquiry.getOwner().getId(), actor.getId())) throw new NoSuchElementException();
        if (close && !admin) throw new IllegalArgumentException();
        Instant now = Instant.now(); messages.save(new SupportMessage(inquiry, actor, admin ? SupportAuthorRole.ADMIN : SupportAuthorRole.USER, body, now));
        if (admin) inquiry.replyByAdmin(close, now); else inquiry.replyByOwner(now);
        return detail(inquiry, admin);
    }
    @Transactional public InquiryView close(AppUser owner, long id) { SupportInquiry inquiry = inquiries.lockById(id).orElseThrow(NoSuchElementException::new); if (!Objects.equals(inquiry.getOwner().getId(), owner.getId())) throw new NoSuchElementException(); inquiry.setStatus(SupportStatus.CLOSED, Instant.now()); return detail(inquiry, false); }
    @Transactional public InquiryView changeStatus(long id, SupportStatus status) { SupportInquiry inquiry = inquiries.lockById(id).orElseThrow(NoSuchElementException::new); inquiry.setStatus(status, Instant.now()); return detail(inquiry, true); }
    @Transactional public void deleteMine(AppUser owner, long id) { SupportInquiry inquiry = inquiries.lockById(id).orElseThrow(NoSuchElementException::new); if (!Objects.equals(inquiry.getOwner().getId(), owner.getId())) throw new NoSuchElementException(); messages.deleteByInquiryId(id); inquiries.delete(inquiry); }
    private PageView page(org.springframework.data.domain.Page<SupportInquiry> page) { return new PageView(page.getContent().stream().map(i -> summary(i)).toList(), page.getNumber(), page.getSize(), page.getTotalElements(), page.hasNext()); }
    private InquiryView detail(SupportInquiry inquiry, boolean admin) { return new InquiryView(summary(inquiry), messages.findByInquiryIdOrderByIdAsc(inquiry.getId()).stream().map(m -> new MessageView(m.getId(), m.getAuthorRole().name(), m.getBody(), m.getCreatedAt())).toList(), admin); }
    private InquirySummary summary(SupportInquiry i) { return new InquirySummary(i.getId(), i.getCategory().name(), i.getTitle(), i.getStatus().name(), i.getCreatedAt(), i.getUpdatedAt(), i.getClosedAt()); }
    public record InquirySummary(long id, String category, String title, String status, Instant createdAt, Instant updatedAt, Instant closedAt) {}
    public record MessageView(long id, String authorRole, String body, Instant createdAt) {}
    public record InquiryView(InquirySummary inquiry, List<MessageView> messages, boolean admin) {}
    public record PageView(List<InquirySummary> items, int page, int size, long total, boolean hasMore) {}
}
