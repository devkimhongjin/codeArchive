package com.codearchive.api.config;

import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.stereotype.Component;

@Component
public class GithubOAuth2FailureHandler implements AuthenticationFailureHandler {

    private final GithubOAuth2Properties properties;

    public GithubOAuth2FailureHandler(GithubOAuth2Properties properties) {
        this.properties = properties;
    }

    @Override
    public void onAuthenticationFailure(HttpServletRequest request, HttpServletResponse response,
                                        AuthenticationException exception) throws IOException, ServletException {
        response.sendRedirect(properties.dashboardRoot() + "/?authError=github");
    }
}
