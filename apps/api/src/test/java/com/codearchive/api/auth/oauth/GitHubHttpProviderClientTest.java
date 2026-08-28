package com.codearchive.api.auth.oauth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import com.codearchive.api.auth.config.AuthProperties;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

class GitHubHttpProviderClientTest {

    private AuthProperties authProperties;
    private MockRestServiceServer server;
    private GitHubHttpProviderClient client;

    @BeforeEach
    void setUp() {
        authProperties = new AuthProperties();
        authProperties.getGithub().setClientId(
                "mock-client-id"
        );
        authProperties.getGithub().setClientSecret(
                "mock-client-secret"
        );
        authProperties.getGithub().setCallbackUrl(
                "https://codearchive.test/callback"
        );
        authProperties.getGithub().setTokenUrl(
                "https://github.test/token"
        );
        authProperties.getGithub().setUserUrl(
                "https://github.test/user"
        );

        RestClient.Builder builder =
                RestClient.builder();
        server = MockRestServiceServer
                .bindTo(builder)
                .build();
        client = new GitHubHttpProviderClient(
                builder,
                authProperties
        );
    }

    @Test
    void exchangesMockedCodeAndReadsStableGithubIdentity() {
        server.expect(requestTo(
                        "https://github.test/token"
                ))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess(
                        "{\"access_token\":\"provider-token\"}",
                        MediaType.APPLICATION_JSON
                ));

        server.expect(requestTo(
                        "https://github.test/user"
                ))
                .andExpect(method(HttpMethod.GET))
                .andExpect(header(
                        HttpHeaders.AUTHORIZATION,
                        "Bearer provider-token"
                ))
                .andRespond(withSuccess(
                        "{"
                                + "\"id\":1001,"
                                + "\"login\":\"tester\","
                                + "\"name\":\"Tester\","
                                + "\"avatar_url\":\"https://example.test/a.png\""
                                + "}",
                        MediaType.APPLICATION_JSON
                ));

        GitHubUserProfile profile =
                client.fetchUser("mock-code");

        assertThat(profile.githubUserId())
                .isEqualTo(1001L);
        assertThat(profile.githubLogin())
                .isEqualTo("tester");
        server.verify();
    }

    @Test
    void providerFailureReturnsOnlySafeGenericError() {
        server.expect(requestTo(
                        "https://github.test/token"
                ))
                .andRespond(withStatus(
                        HttpStatus.UNAUTHORIZED
                ).body(
                        "provider-secret-response"
                ));

        assertThatThrownBy(() ->
                client.fetchUser("mock-code")
        )
                .isInstanceOf(CodeArchiveException.class)
                .satisfies(exception -> {
                    CodeArchiveException codeArchiveException =
                            (CodeArchiveException) exception;
                    assertThat(
                            codeArchiveException.getErrorCode()
                    ).isEqualTo(
                            ErrorCode.EXTERNAL_API_ERROR
                    );
                    assertThat(
                            codeArchiveException.getMessage()
                    ).doesNotContain(
                            "provider-secret-response"
                    );
                });
    }
}
