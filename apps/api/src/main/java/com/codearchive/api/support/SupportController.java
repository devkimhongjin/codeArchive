package com.codearchive.api.support;

import com.codearchive.api.auth.UserRepository;
import com.codearchive.api.common.ApiError;
import com.codearchive.api.common.GithubAccountAssertion;
import com.codearchive.api.community.CommunityRateLimiter;
import java.util.NoSuchElementException;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/support")
public class SupportController {
    private final UserRepository users; private final SupportService support; private final CommunityRateLimiter rateLimiter;
    public SupportController(UserRepository users, SupportService support, CommunityRateLimiter rateLimiter) { this.users = users; this.support = support; this.rateLimiter = rateLimiter; }

    @GetMapping("/access") public ResponseEntity<?> access(Authentication auth, @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected) {
        var checked = account(auth, expected); if (!checked.accepted()) return checked.failure();
        if (!read(checked.account().user().getId())) return limited();
        return noStore(new AccessResponse(SupportAdminPolicy.isAdmin(checked.account().githubId(), checked.account().user())));
    }
    @GetMapping("/tickets") public ResponseEntity<?> mine(Authentication auth, @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected, @RequestParam(defaultValue = "0") int page) {
        var checked = account(auth, expected); if (!checked.accepted()) return checked.failure(); if (!read(checked.account().user().getId())) return limited(); if (!page(page)) return bad("Invalid support page"); return noStore(support.mine(checked.account().user().getId(), page));
    }
    @PostMapping("/tickets") public ResponseEntity<?> create(Authentication auth, @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected, @RequestBody TicketRequest request) {
        var checked = account(auth, expected); if (!checked.accepted()) return checked.failure(); if (!write(checked.account().user().getId())) return limited();
        SupportCategory category = category(request == null ? null : request.category()); String title = clean(request == null ? null : request.title(), 150); String body = clean(request == null ? null : request.body(), 10000);
        if (category == null || title == null || body == null) return bad("Invalid support inquiry"); return noStore(support.create(checked.account().user(), category, title, body));
    }
    @GetMapping("/tickets/{id}") public ResponseEntity<?> detail(Authentication auth, @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected, @PathVariable long id) {
        var checked = account(auth, expected); if (!checked.accepted()) return checked.failure(); if (!read(checked.account().user().getId())) return limited(); if (id <= 0) return bad("Invalid support inquiry"); try { return noStore(support.mineDetail(checked.account().user().getId(), id)); } catch (NoSuchElementException e) { return ResponseEntity.notFound().build(); }
    }
    @PostMapping("/tickets/{id}/messages") public ResponseEntity<?> reply(Authentication auth, @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected, @PathVariable long id, @RequestBody MessageRequest request) {
        var checked = account(auth, expected); if (!checked.accepted()) return checked.failure();
        if (!write(checked.account().user().getId())) return limited();
        return ResponseEntity.status(410).cacheControl(CacheControl.noStore()).body(new ApiError("Inquiry follow-up, closure and deletion are no longer supported"));
    }
    @PostMapping("/tickets/{id}/close") public ResponseEntity<?> close(Authentication auth, @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected, @PathVariable long id) {
        var checked = account(auth, expected); if (!checked.accepted()) return checked.failure();
        if (!write(checked.account().user().getId())) return limited();
        return ResponseEntity.status(410).cacheControl(CacheControl.noStore()).body(new ApiError("Inquiry follow-up, closure and deletion are no longer supported"));
    }
    @DeleteMapping("/tickets/{id}") public ResponseEntity<?> delete(Authentication auth, @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected, @PathVariable long id) {
        var checked = account(auth, expected); if (!checked.accepted()) return checked.failure();
        if (!write(checked.account().user().getId())) return limited();
        return ResponseEntity.status(410).cacheControl(CacheControl.noStore()).body(new ApiError("Inquiry follow-up, closure and deletion are no longer supported"));
    }
    @GetMapping("/admin/tickets") public ResponseEntity<?> all(Authentication auth, @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected, @RequestParam(defaultValue = "0") int page) {
        var checked = admin(auth, expected); if (!checked.accepted()) return checked.failure(); if (!read(checked.account().user().getId())) return limited(); if (!page(page)) return bad("Invalid support page"); return noStore(support.all(page));
    }
    @GetMapping("/admin/tickets/{id}") public ResponseEntity<?> adminDetail(Authentication auth, @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected, @PathVariable long id) {
        var checked = admin(auth, expected); if (!checked.accepted()) return checked.failure(); if (!read(checked.account().user().getId())) return limited(); if (id <= 0) return bad("Invalid support inquiry"); try { return noStore(support.adminDetail(id)); } catch (NoSuchElementException e) { return ResponseEntity.notFound().build(); }
    }
    @PostMapping("/admin/tickets/{id}/messages") public ResponseEntity<?> adminReply(Authentication auth, @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected, @PathVariable long id, @RequestBody MessageRequest request) {
        var checked = admin(auth, expected); if (!checked.accepted()) return checked.failure(); if (!write(checked.account().user().getId())) return limited(); String body = clean(request == null ? null : request.body(), 10000); if (id <= 0 || body == null || request.close()) return bad("Invalid support answer"); try { return noStore(support.answer(checked.account().user(), id, body)); } catch (NoSuchElementException e) { return ResponseEntity.notFound().build(); }
    }
    @PutMapping("/admin/tickets/{id}/status") public ResponseEntity<?> status(Authentication auth, @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected, @PathVariable long id, @RequestBody StatusRequest request) {
        var checked = admin(auth, expected); if (!checked.accepted()) return checked.failure(); if (!write(checked.account().user().getId())) return limited(); SupportStatus status = status(request == null ? null : request.status()); if (id <= 0 || status == null || status == SupportStatus.CLOSED) return bad("Invalid support status"); try { return noStore(support.changeStatus(id, status)); } catch (NoSuchElementException e) { return ResponseEntity.notFound().build(); } catch (IllegalArgumentException e) { return bad("An administrator answer is required before ANSWERED"); }
    }
    private GithubAccountAssertion.Checked account(Authentication auth, String expected) { return GithubAccountAssertion.require(auth, expected, users); }
    private GithubAccountAssertion.Checked admin(Authentication auth, String expected) { var checked = account(auth, expected); if (!checked.accepted()) return checked; if (!SupportAdminPolicy.isAdmin(checked.account().githubId(), checked.account().user())) return new GithubAccountAssertion.Checked(null, ResponseEntity.status(403).body(new ApiError("Support administrator access is required"))); return checked; }
    private boolean read(long id) { return rateLimiter.allowRead(id); } private boolean write(long id) { return rateLimiter.allowWrite(id); }
    private static boolean page(int page) { return page >= 0 && page <= 1000; }
    private static SupportCategory category(String value) { try { return value == null ? null : SupportCategory.valueOf(value); } catch (IllegalArgumentException e) { return null; } }
    private static SupportStatus status(String value) { try { return value == null ? null : SupportStatus.valueOf(value); } catch (IllegalArgumentException e) { return null; } }
    private static String clean(String value, int max) { if (value == null) return null; String trimmed = value.trim(); return trimmed.isEmpty() || trimmed.length() > max ? null : trimmed; }
    private static ResponseEntity<?> bad(String message) { return ResponseEntity.badRequest().body(new ApiError(message)); }
    private static ResponseEntity<?> limited() { return ResponseEntity.status(429).header("Retry-After", "60").body(new ApiError("Support request limit reached; retry later")); }
    private static ResponseEntity<?> noStore(Object body) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body); }
    public record AccessResponse(boolean admin) {} public record TicketRequest(String category, String title, String body) {} public record MessageRequest(String body, boolean close) {} public record StatusRequest(String status) {}
}
