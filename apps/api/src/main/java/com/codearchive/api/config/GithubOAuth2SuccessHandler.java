package com.codearchive.api.config;

import com.codearchive.api.auth.GithubAccountService;
import com.codearchive.api.auth.DesktopLoginService;
import com.codearchive.api.auth.DesktopBrowserRedirect;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.stereotype.Component;

@Component
public class GithubOAuth2SuccessHandler implements AuthenticationSuccessHandler {

    private final GithubAccountService accountService;
    private final GithubOAuth2Properties properties;
    private final DesktopLoginService desktopLogin;

    public GithubOAuth2SuccessHandler(GithubAccountService accountService, GithubOAuth2Properties properties, DesktopLoginService desktopLogin) {
        this.accountService = accountService;
        this.properties = properties;
        this.desktopLogin = desktopLogin;
    }

    @Override
    public void onAuthenticationSuccess(HttpServletRequest request, HttpServletResponse response,
                                        Authentication authentication) throws IOException, ServletException {
        if (!(authentication instanceof OAuth2AuthenticationToken oauth2)
                || !"github".equalsIgnoreCase(oauth2.getAuthorizedClientRegistrationId())) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "GitHub authentication is required");
            return;
        }
        OAuth2User principal = oauth2.getPrincipal();
        accountService.upsert(principal);
        if (request.getSession(false) != null && request.getSession(false).getAttribute(DesktopLoginService.SESSION_KEY) instanceof String id) {
            try {
                desktopLogin.check(id);
                if (request.getSession(false).getAttribute(DesktopLoginService.CALLBACK_KEY) instanceof DesktopLoginService.CallbackIntent callback
                        && id.equals(callback.id()) && callback.expiresAt() > System.currentTimeMillis()) {
                    String githubId = com.codearchive.api.auth.GithubAuthentication.githubId(authentication).orElseThrow();
                    String code = desktopLogin.approveCallback(id, githubId);
                    request.getSession(false).setAttribute(DesktopLoginService.COMPLETED_KEY,
                            new DesktopLoginService.CallbackResult(callback.requestId(), callback.state(), code, callback.expiresAt()));
                    request.getSession(false).removeAttribute(DesktopLoginService.SESSION_KEY);
                    request.getSession(false).removeAttribute(DesktopLoginService.CALLBACK_KEY);
                    request.getSession(false).removeAttribute(DesktopLoginService.CONSENT_KEY);
                    DesktopBrowserRedirect.complete(response);
                } else if (id.equals(request.getSession(false).getAttribute(DesktopLoginService.CONSENT_KEY))) {
                    String githubId = com.codearchive.api.auth.GithubAuthentication.githubId(authentication).orElseThrow();
                    desktopLogin.approve(id, githubId);
                    request.getSession(false).removeAttribute(DesktopLoginService.SESSION_KEY);
                    request.getSession(false).removeAttribute(DesktopLoginService.CONSENT_KEY);
                    request.getSession(false).setAttribute(DesktopLoginService.COMPLETED_KEY, System.currentTimeMillis() + 300000L);
                    DesktopBrowserRedirect.complete(response);
                } else DesktopBrowserRedirect.confirm(response); // Compatibility for already-open legacy approval pages.
                return;
            } catch (DesktopLoginService.Failure unavailable) {
                if (request.getSession(false).getAttribute(DesktopLoginService.CALLBACK_KEY) instanceof DesktopLoginService.CallbackIntent callback)
                    request.getSession(false).setAttribute(DesktopLoginService.FAILED_KEY, new DesktopLoginService.CallbackFailure(callback.state(), callback.expiresAt()));
                request.getSession(false).removeAttribute(DesktopLoginService.SESSION_KEY);
                request.getSession(false).removeAttribute(DesktopLoginService.CONSENT_KEY);
                request.getSession(false).removeAttribute(DesktopLoginService.CALLBACK_KEY);
                DesktopBrowserRedirect.failed(response); return;
            }
        }
        if (request.getSession(false) != null && request.getSession(false).getAttribute(DesktopLoginService.INSTALL_KEY) instanceof DesktopLoginService.InstallIntent intent) {
            if (intent.expiresAt() > System.currentTimeMillis()) { DesktopBrowserRedirect.install(response); return; }
            request.getSession(false).removeAttribute(DesktopLoginService.INSTALL_KEY);
        }
        response.sendRedirect(properties.dashboardRoot() + "/");
    }
}
