package com.codearchive.api.config;

import com.codearchive.api.auth.GithubAccountService;
import com.codearchive.api.auth.DesktopLoginService;
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
            try { desktopLogin.check(id); response.sendRedirect("/api/desktop-auth/confirm"); return; }
            catch (DesktopLoginService.Failure unavailable) { request.getSession(false).removeAttribute(DesktopLoginService.SESSION_KEY); }
        }
        if (request.getSession(false) != null && request.getSession(false).getAttribute(DesktopLoginService.INSTALL_KEY) instanceof DesktopLoginService.InstallIntent intent) {
            if (intent.expiresAt() > System.currentTimeMillis()) { response.sendRedirect("/api/desktop-auth/install"); return; }
            request.getSession(false).removeAttribute(DesktopLoginService.INSTALL_KEY);
        }
        response.sendRedirect(properties.dashboardRoot() + "/");
    }
}
