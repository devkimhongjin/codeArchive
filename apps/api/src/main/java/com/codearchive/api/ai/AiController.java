package com.codearchive.api.ai;

import com.codearchive.api.auth.UserRepository;
import com.codearchive.api.common.ApiError;
import com.codearchive.api.common.GithubAccountAssertion;
import com.codearchive.api.community.CommunityRateLimiter;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

/** AI code review endpoints. Every answer is account-bound and never cached by the browser. */
@RestController
@RequestMapping("/api/ai")
public class AiController {
    private final UserRepository users; private final AiReviewService ai; private final CommunityRateLimiter rateLimiter;
    public AiController(UserRepository users, AiReviewService ai, CommunityRateLimiter rateLimiter) { this.users = users; this.ai = ai; this.rateLimiter = rateLimiter; }

    public record ConsentRequest(String noticeVersion) {}

    @GetMapping("/status") public ResponseEntity<?> status(Authentication auth, @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected) {
        var checked = GithubAccountAssertion.require(auth, expected, users); if (!checked.accepted()) return checked.failure();
        if (!rateLimiter.allowRead(checked.account().user().getId())) return limited();
        return noStore(ai.status(checked.account().user()));
    }
    @PostMapping("/consent") public ResponseEntity<?> consent(Authentication auth, @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected, @RequestBody(required = false) ConsentRequest request) {
        var checked = GithubAccountAssertion.require(auth, expected, users); if (!checked.accepted()) return checked.failure();
        if (!rateLimiter.allowWrite(checked.account().user().getId())) return limited();
        try { return noStore(ai.consent(checked.account().user(), request == null ? null : request.noticeVersion())); }
        catch (IllegalArgumentException e) { return error(409, "AI_NOTICE_CHANGED"); }
    }
    @DeleteMapping("/consent") public ResponseEntity<?> revoke(Authentication auth, @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected) {
        var checked = GithubAccountAssertion.require(auth, expected, users); if (!checked.accepted()) return checked.failure();
        if (!rateLimiter.allowWrite(checked.account().user().getId())) return limited();
        return noStore(ai.revoke(checked.account().user()));
    }
    @GetMapping("/reviews/{captureId}") public ResponseEntity<?> cached(Authentication auth, @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected, @PathVariable String captureId) {
        var checked = GithubAccountAssertion.require(auth, expected, users); if (!checked.accepted()) return checked.failure();
        if (!rateLimiter.allowRead(checked.account().user().getId())) return limited();
        if (!validCapture(captureId)) return error(400, "INVALID_CAPTURE");
        try { return ai.cached(checked.account().user(), captureId).<ResponseEntity<?>>map(this::noStore).orElseGet(() -> ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build()); }
        catch (AiReviewService.AiReviewException e) { return error(e.failure().status(), e.failure().name()); }
    }
    @PostMapping("/reviews/{captureId}") public ResponseEntity<?> request(Authentication auth, @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected, @PathVariable String captureId) {
        var checked = GithubAccountAssertion.require(auth, expected, users); if (!checked.accepted()) return checked.failure();
        if (!rateLimiter.allowWrite(checked.account().user().getId())) return limited();
        if (!validCapture(captureId)) return error(400, "INVALID_CAPTURE");
        try { return noStore(ai.request(checked.account().user(), captureId)); }
        catch (AiReviewService.AiReviewException e) { return error(e.failure().status(), e.failure().name()); }
    }

    private static boolean validCapture(String captureId) { return captureId != null && captureId.matches("[A-Za-z0-9-]{1,36}"); }
    private ResponseEntity<?> noStore(Object body) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body); }
    private static ResponseEntity<?> error(int status, String code) { return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(new ApiError(code)); }
    private static ResponseEntity<?> limited() { return ResponseEntity.status(429).header("Retry-After", "60").body(new ApiError("RATE_LIMITED")); }
}
