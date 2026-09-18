package com.codearchive.api.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;

class GithubOAuth2AuthorizationRequestResolverTest {

    @Test
    void dashboardLoginAlwaysRequestsGithubAccountSelection() {
        GithubOAuth2Properties properties = new GithubOAuth2Properties();
        properties.setClientId("client-id");
        properties.setClientSecret("client-secret");
        properties.setRedirectUri("http://localhost:5173/api/login/oauth2/code/github");

        ClientRegistrationRepository registrations = new GithubOAuth2ClientConfiguration()
                .clientRegistrationRepository(properties);
        OAuth2AuthorizationRequestResolver resolver = new SecurityConfig()
                .githubAuthorizationRequestResolver(registrations);
        MockHttpServletRequest request = new MockHttpServletRequest(
                "GET", "/api/oauth2/authorization/github");
        request.setServletPath("/api/oauth2/authorization/github");

        OAuth2AuthorizationRequest authorization = resolver.resolve(request);

        assertThat(authorization).isNotNull();
        assertThat(authorization.getAdditionalParameters())
                .containsEntry("prompt", "select_account");
        assertThat(authorization.getAuthorizationRequestUri())
                .contains("prompt=select_account")
                .contains("redirect_uri=http://localhost:5173/api/login/oauth2/code/github");
    }
}
