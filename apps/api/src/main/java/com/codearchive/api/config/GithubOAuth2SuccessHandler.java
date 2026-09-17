package com.codearchive.api.config;

import com.codearchive.api.auth.GithubAccountService;
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

    public GithubOAuth2SuccessHandler(GithubAccountService accountService, GithubOAuth2Properties properties) {
        this.accountService = accountService;
        this.properties = properties;
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
        response.sendRedirect(properties.dashboardRoot() + "/");
    }
}
