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
                                   HttpSession session) {
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
            String installUrl = states.issue(user.getId(), checked.account().githubId(), session);
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
        if (identity.isEmpty()) return redirect("authentication_required", null);
        AppUser user = users.findByGithubId(identity.get().githubId()).orElse(null);
        if (user == null || user.getId() == null) return redirect("authentication_required", null);

        try {
            states.consume(state, user.getId(), identity.get().githubId(), session);
        } catch (InstallStateException exception) {
            return redirect(switch (exception.failure()) {
                case EXPIRED -> "expired";
                case ACCOUNT_MISMATCH -> "account_mismatch";
                case PROVIDER_UNAVAILABLE -> "provider_unavailable";
                case INVALID, REPLAYED -> "invalid";
            }, null);
        }

        // GitHub's documented setup callback contract guarantees installation_id,
        // but not setup_action. The signed one-time state and the ownership lookup
        // below are the trust boundaries, so an omitted setup_action must not turn a
        // successful installation into a false cancellation.
        if (installationId == null || installationId <= 0) {
            return redirect("cancelled", null);
        }
        try {
            boolean owned = github.installations(identity.get().githubId()).stream()
                    .anyMatch(installation -> installation.id() == installationId);
            if (!owned) return redirect("installation_unavailable", null);
            return redirect("success", installationId);
        } catch (ProviderUnavailableException exception) {
            return redirect("provider_unavailable", null);
        } catch (SecurityException exception) {
            return redirect("installation_unavailable", null);
        } catch (Exception exception) {
            return redirect("provider_unavailable", null);
        }
    }

    private ResponseEntity<Void> redirect(String result, Long installationId) {
        String target = properties.dashboardRoot() + "/?githubInstall=" + result;
        if (installationId != null) target += "&installationId=" + installationId;
        return ResponseEntity.status(302).location(URI.create(target)).build();
    }

    public record StartResponse(String status, List<GithubAppProvider.InstallationChoice> installations,
                                String installUrl) {}
}
