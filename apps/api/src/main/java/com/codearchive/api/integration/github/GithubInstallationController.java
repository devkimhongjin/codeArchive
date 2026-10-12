package com.codearchive.api.integration.github;

import com.codearchive.api.auth.AppUser;
import com.codearchive.api.auth.GithubAuthentication;
import com.codearchive.api.auth.UserRepository;
import com.codearchive.api.automation.GithubAppProvider;
import com.codearchive.api.automation.GithubAppProvider.ProviderUnavailableException;
import com.codearchive.api.common.ApiError;
import com.codearchive.api.common.GithubAccountAssertion;
import com.codearchive.api.config.GithubOAuth2Properties;
import com.codearchive.api.integration.github.GithubInstallStateService.InstallStateException;
import jakarta.servlet.http.HttpSession;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/github/installations")
public class GithubInstallationController {
    private final UserRepository users;
    private final GithubAppProvider github;
    private final GithubInstallStateService states;
    private final GithubOAuth2Properties properties;

    public GithubInstallationController(UserRepository users, GithubAppProvider github,
                                        GithubInstallStateService states, GithubOAuth2Properties properties) {
        this.users = users;
        this.github = github;
        this.states = states;
        this.properties = properties;
    }

    @PostMapping("/start")
    public ResponseEntity<?> start(Authentication authentication,
                                   @RequestHeader(value = GithubAccountAssertion.HEADER, required = false)
                                   String expectedGithubId,
                                   HttpSession session, HttpServletRequest request) {
        var checked = GithubAccountAssertion.require(authentication, expectedGithubId, users);
        if (!checked.accepted()) return checked.failure();
        if (!github.browseReady() || !states.ready()) {
            return ResponseEntity.status(503).body(new ApiError("GitHub App provider is unavailable"));
        }
        try {
            List<GithubAppProvider.InstallationChoice> installations =
                    github.installations(checked.account().githubId());
            if (!installations.isEmpty()) {
                return ResponseEntity.ok(new StartResponse("AVAILABLE", installations, null));
            }
            AppUser user = checked.account().user();
            String installUrl = states.issue(user.getId(), checked.account().githubId(), session,
                    request != null && com.codearchive.api.config.SecurityConfig.isExtensionOrigin(request.getHeader("Origin")));
            return ResponseEntity.ok(new StartResponse("INSTALL_REQUIRED", List.of(), installUrl));
        } catch (SecurityException exception) {
            return ResponseEntity.status(403).body(new ApiError("GitHub installation is not available to this account"));
        } catch (Exception exception) {
            return ResponseEntity.status(503).body(new ApiError("GitHub App provider is unavailable"));
        }
    }

    @GetMapping("/callback")
    public ResponseEntity<Void> callback(Authentication authentication,
                                         @RequestParam(value = "state", required = false) String state,
                                         @RequestParam(value = "installation_id", required = false) Long installationId,
                                         HttpSession session) {
        var identity = GithubAuthentication.identity(authentication);
        if (identity.isEmpty()) return redirectForState("authentication_required", null, state);
        AppUser user = users.findByGithubId(identity.get().githubId()).orElse(null);
        if (user == null || user.getId() == null) return redirectForState("authentication_required", null, state);

        final GithubInstallStateService.Payload payload;
        try {
            payload = states.consume(state, user.getId(), identity.get().githubId(), session);
        } catch (InstallStateException exception) {
            return redirectForState(switch (exception.failure()) {
                case EXPIRED -> "expired";
                case ACCOUNT_MISMATCH -> "account_mismatch";
                case PROVIDER_UNAVAILABLE -> "provider_unavailable";
                case INVALID, REPLAYED -> "invalid";
            }, null, state);
        }

        // GitHub's documented setup callback contract guarantees installation_id,
        // but not setup_action. The signed one-time state and the ownership lookup
        // below are the trust boundaries, so an omitted setup_action must not turn a
        // successful installation into a false cancellation.
        if (installationId == null || installationId <= 0) {
            return callbackRedirect("cancelled", null, payload);
        }
        try {
            boolean owned = github.installations(identity.get().githubId()).stream()
                    .anyMatch(installation -> installation.id() == installationId);
            if (!owned) return callbackRedirect("installation_unavailable", null, payload);
            return callbackRedirect("success", installationId, payload);
        } catch (ProviderUnavailableException exception) {
            return callbackRedirect("provider_unavailable", null, payload);
        } catch (SecurityException exception) {
            return callbackRedirect("installation_unavailable", null, payload);
        } catch (Exception exception) {
            return callbackRedirect("provider_unavailable", null, payload);
        }
    }
    /** Native desktop handoff invokes the controller directly and must retain the legacy return route. */
    public ResponseEntity<?> start(Authentication authentication, String expectedGithubId, HttpSession session) {
        return start(authentication, expectedGithubId, session, null);
    }

    @GetMapping("/setup")
    public ResponseEntity<Void> setup(@RequestParam(value = "state", required = false) String state,
                                      @RequestParam(value = "installation_id", required = false) Long installationId) {
        var direct = states.setupReturn(state);
        if (direct.isEmpty()) return ResponseEntity.badRequest().build();
        String root = direct.get() ? properties.extensionApiRoot() : properties.dashboardRoot();
        String target = root + "/api/github/installations/callback?state=" + URLEncoder.encode(state, StandardCharsets.UTF_8);
        if (installationId != null && installationId > 0) target += "&installation_id=" + installationId;
        return ResponseEntity.status(302).location(URI.create(target)).build();
    }

    private ResponseEntity<Void> redirect(String result, Long installationId) {
        String target = properties.dashboardRoot() + "/?githubInstall=" + result;
        if (installationId != null) target += "&installationId=" + installationId;
        return ResponseEntity.status(302).location(URI.create(target)).build();
    }
    private ResponseEntity<Void> callbackRedirect(String result, Long installationId, GithubInstallStateService.Payload payload) {
        return GithubInstallStateService.isExtensionReturn(payload) ? directRedirect(result, installationId) : redirect(result, installationId);
    }
    /**
     * Authentication can fail before the session-bound state is consumable.
     * A valid signed state is sufficient to select one of two fixed landing
     * pages; it never grants, consumes, or reveals installation ownership.
     */
    private ResponseEntity<Void> redirectForState(String result, Long installationId, String state) {
        var direct = states.errorReturn(state);
        // An invalid opaque callback value still has no influence over the
        // destination. Preserve the fixed legacy error landing for old tabs;
        // only a valid v2 signature selects the API completion route.
        if (direct.isEmpty()) return redirect(result, installationId);
        return direct.get() ? directRedirect(result, installationId) : redirect(result, installationId);
    }
    private ResponseEntity<Void> directRedirect(String result, Long installationId) {
        String target = properties.extensionApiRoot() + "/api/extension-login/complete?githubInstall=" + result;
        if (installationId != null) target += "&installationId=" + installationId;
        return ResponseEntity.status(302).location(URI.create(target)).build();
    }

    public record StartResponse(String status, List<GithubAppProvider.InstallationChoice> installations,
                                String installUrl) {}
}
