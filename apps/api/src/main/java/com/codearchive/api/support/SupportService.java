package com.codearchive.api.support;

import com.codearchive.api.auth.AppUser;
import java.time.Instant;
import java.util.List;
import java.util.NoSuchElementException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SupportService {
    private final SupportInquiryRepository inquiries;
    private final SupportMessageRepository messages;
    public SupportService(SupportInquiryRepository inquiries, SupportMessageRepository messages) { this.inquiries = inquiries; this.messages = messages; }
    @Transactional public InquiryView create(AppUser owner, SupportCategory category, String title, String body) {
        Instant now = Instant.now(); SupportInquiry inquiry = inquiries.save(new SupportInquiry(owner, category, title, now));
        messages.save(new SupportMessage(inquiry, owner, SupportAuthorRole.USER, body, now)); return detail(inquiry, false);
    }
    @Transactional(readOnly = true) public PageView mine(long ownerId, int page) { var result = inquiries.findByOwnerIdOrderByUpdatedAtDescIdDesc(ownerId, PageRequest.of(page, 20)); return page(result); }
    @Transactional(readOnly = true) public PageView all(int page) { var result = inquiries.findAllByOrderByUpdatedAtDescIdDesc(PageRequest.of(page, 20)); return page(result); }
    @Transactional(readOnly = true) public InquiryView mineDetail(long ownerId, long id) { return detail(inquiries.findByIdAndOwnerId(id, ownerId).orElseThrow(NoSuchElementException::new), false); }
    @Transactional(readOnly = true) public InquiryView adminDetail(long id) { return detail(inquiries.findById(id).orElseThrow(NoSuchElementException::new), true); }
    @Transactional public InquiryView answer(AppUser actor, long id, String body) {
        if (!SupportAdminPolicy.isAdmin(actor.getGithubId(), actor)) throw new IllegalArgumentException("Administrator required");
        SupportInquiry inquiry = inquiries.lockById(id).orElseThrow(NoSuchElementException::new);
        Instant now = Instant.now();
        var existing = messages.findFirstByInquiryIdAndAuthorRoleOrderByIdDesc(id, SupportAuthorRole.ADMIN);
        if (existing.isPresent()) existing.get().updateAnswer(body);
        else messages.save(new SupportMessage(inquiry, actor, SupportAuthorRole.ADMIN, body, now));
        inquiry.setStatus(SupportStatus.ANSWERED, now);
        return detail(inquiry, true);
    }
    @Transactional public InquiryView changeStatus(long id, SupportStatus status) {
        SupportInquiry inquiry = inquiries.lockById(id).orElseThrow(NoSuchElementException::new);
        if (status == SupportStatus.ANSWERED && messages.findFirstByInquiryIdAndAuthorRoleOrderByIdDesc(id, SupportAuthorRole.ADMIN).isEmpty()) throw new IllegalArgumentException("An administrator answer is required");
        inquiry.setStatus(status, Instant.now()); return detail(inquiry, true);
    }
    private PageView page(org.springframework.data.domain.Page<SupportInquiry> page) { return new PageView(page.getContent().stream().map(i -> summary(i)).toList(), page.getNumber(), page.getSize(), page.getTotalElements(), page.hasNext()); }
    private InquiryView detail(SupportInquiry inquiry, boolean admin) { return new InquiryView(summary(inquiry), messages.findByInquiryIdOrderByIdAsc(inquiry.getId()).stream().map(m -> new MessageView(m.getId(), m.getAuthorRole().name(), m.getBody(), m.getCreatedAt())).toList(), admin); }
    private InquirySummary summary(SupportInquiry i) { return new InquirySummary(i.getId(), i.getCategory().name(), i.getTitle(), i.getStatus() == SupportStatus.CLOSED ? "OPEN" : i.getStatus().name(), i.getCreatedAt(), i.getUpdatedAt(), i.getClosedAt()); }
    public record InquirySummary(long id, String category, String title, String status, Instant createdAt, Instant updatedAt, Instant closedAt) {}
    public record MessageView(long id, String authorRole, String body, Instant createdAt) {}
    public record InquiryView(InquirySummary inquiry, List<MessageView> messages, boolean admin) {}
    public record PageView(List<InquirySummary> items, int page, int size, long total, boolean hasMore) {}
}
