package com.codearchive.api.config;

import jakarta.servlet.ServletException;
import com.codearchive.api.auth.DesktopLoginService;
import com.codearchive.api.auth.DesktopBrowserRedirect;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.stereotype.Component;

@Component
public class GithubOAuth2FailureHandler implements AuthenticationFailureHandler {

    private final GithubOAuth2Properties properties;
    private final DesktopLoginService desktopLogin;

    public GithubOAuth2FailureHandler(GithubOAuth2Properties properties, DesktopLoginService desktopLogin) {
        this.properties = properties;
        this.desktopLogin = desktopLogin;
    }

    @Override
    public void onAuthenticationFailure(HttpServletRequest request, HttpServletResponse response,
                                        AuthenticationException exception) throws IOException, ServletException {
        if (request.getSession(false) != null && (request.getSession(false).getAttribute(DesktopLoginService.SESSION_KEY) != null
                || request.getSession(false).getAttribute(DesktopLoginService.INSTALL_KEY) != null)) {
            if (request.getSession(false).getAttribute(DesktopLoginService.SESSION_KEY) instanceof String id) desktopLogin.cancel(id);
            if (request.getSession(false).getAttribute(DesktopLoginService.CALLBACK_KEY) instanceof DesktopLoginService.CallbackIntent callback)
                request.getSession(false).setAttribute(DesktopLoginService.FAILED_KEY, new DesktopLoginService.CallbackFailure(callback.state(), callback.expiresAt()));
            request.getSession(false).removeAttribute(DesktopLoginService.CALLBACK_KEY);
            request.getSession(false).removeAttribute(DesktopLoginService.SESSION_KEY);
            request.getSession(false).removeAttribute(DesktopLoginService.CONSENT_KEY);
            request.getSession(false).removeAttribute(DesktopLoginService.COMPLETED_KEY);
            request.getSession(false).removeAttribute(DesktopLoginService.INSTALL_KEY);
            DesktopBrowserRedirect.failed(response);
        } else response.sendRedirect(properties.dashboardRoot() + "/?authError=github");
    }
}
