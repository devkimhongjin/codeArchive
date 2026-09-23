package com.codearchive.api.community;

import com.codearchive.api.auth.UserRepository;
import com.codearchive.api.common.ApiError;
import com.codearchive.api.common.GithubAccountAssertion;
import com.codearchive.api.solution.Platform;
import java.util.Locale;
import java.util.NoSuchElementException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.CacheControl;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/community")
public class CommunityController {
    private final UserRepository users;
    private final CommunityService community;
    private final CommunityRateLimiter rateLimiter;

    public CommunityController(UserRepository users, CommunityService community, CommunityRateLimiter rateLimiter) {
        this.users = users;
        this.community = community;
        this.rateLimiter = rateLimiter;
    }

    @PutMapping("/solutions/{id}/visibility")
    public ResponseEntity<?> visibility(Authentication authentication,
            @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected,
            @PathVariable long id, @RequestBody VisibilityRequest request) {
        var checked = GithubAccountAssertion.require(authentication, expected, users);
        if (!checked.accepted()) return checked.failure();
        if (!rateLimiter.allowWrite(checked.account().user().getId())) return tooManyRequests();
        if (id <= 0 || request == null ||
                !("private".equals(request.visibility()) || "published".equals(request.visibility()))) {
            return ResponseEntity.badRequest().body(new ApiError("Invalid visibility"));
        }
        try {
            return ResponseEntity.ok(community.setVisibility(checked.account().user().getId(), id,
                    "published".equals(request.visibility())));
        } catch (NoSuchElementException ignored) {
            return ResponseEntity.notFound().build();
        } catch (CommunityService.InvalidSolutionException ignored) {
            return ResponseEntity.status(409).body(new ApiError("Only accepted solutions can be published"));
        }
    }

    @GetMapping("/solutions")
    public ResponseEntity<?> list(Authentication authentication,
            @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected,
            @RequestParam String platform, @RequestParam String problemNumber,
            @RequestParam(required = false) String languageKey,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        var checked = GithubAccountAssertion.require(authentication, expected, users);
        if (!checked.accepted()) return checked.failure();
        if (!rateLimiter.allowRead(checked.account().user().getId())) return tooManyRequests();
        Platform parsed = platform(platform);
        if (parsed == null || !safeProblemNumber(problemNumber) || page < 0 || page > 1000 || size < 1 || size > 50
                || (languageKey != null && !languageKey.matches("[a-z0-9:._-]{1,100}"))) {
            return ResponseEntity.badRequest().body(new ApiError("Invalid community query"));
        }
        try {
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(community.list(checked.account().user().getId(), parsed,
                    problemNumber, languageKey, page, size));
        } catch (CommunityService.NotEligibleException ignored) {
            return ResponseEntity.status(403).body(new ApiError("Publish your solution to this problem first"));
        }
    }

    @GetMapping("/solutions/{id}")
    public ResponseEntity<?> detail(Authentication authentication,
            @RequestHeader(value = GithubAccountAssertion.HEADER, required = false) String expected,
            @PathVariable long id) {
        var checked = GithubAccountAssertion.require(authentication, expected, users);
        if (!checked.accepted()) return checked.failure();
        if (!rateLimiter.allowRead(checked.account().user().getId())) return tooManyRequests();
        if (id <= 0) return ResponseEntity.badRequest().body(new ApiError("Invalid solution"));
        try {
            return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                    .body(community.detail(checked.account().user().getId(), id));
        } catch (NoSuchElementException ignored) {
            // The same response covers nonexistent, private, and unauthorized IDs.
            return ResponseEntity.notFound().build();
        }
    }

    private static Platform platform(String value) {
        try { return Platform.valueOf(value.toUpperCase(Locale.ROOT)); }
        catch (IllegalArgumentException | NullPointerException ignored) { return null; }
    }

    private static boolean safeProblemNumber(String value) {
        return value != null && value.matches("[A-Za-z0-9_-]{1,100}");
    }

    private static ResponseEntity<ApiError> tooManyRequests() {
        return ResponseEntity.status(429).header("Retry-After", "60")
                .body(new ApiError("Community request limit reached; retry later"));
    }

    public record VisibilityRequest(String visibility) {}
}
