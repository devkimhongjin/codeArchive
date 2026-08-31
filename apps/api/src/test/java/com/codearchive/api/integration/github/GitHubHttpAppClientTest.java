package com.codearchive.api.integration.github;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.time.Instant;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

@ExtendWith(OutputCaptureExtension.class)
class GitHubHttpAppClientTest {
    private static final String API = "https://api.github.com";
    private MockRestServiceServer server;
    private GitHubHttpAppClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        GitHubAppJwt jwt = mock(GitHubAppJwt.class);
        when(jwt.issue()).thenReturn("app_jwt_canary");
        client = new GitHubHttpAppClient(jwt, builder.build());
    }

    @Test
    void resolvesPersonalInstallationUsingAppJwtAndIgnoresExtraProviderFields(CapturedOutput output) {
        server.expect(requestTo(API + "/users/alice/installation"))
                .andExpect(method(HttpMethod.GET))
                .andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer app_jwt_canary"))
                .andExpect(header("X-GitHub-Api-Version", "2026-03-10"))
                .andRespond(withSuccess("""
                        {"id":701,"account":{"id":101,"login":"alice","type":"User"},
                         "repository_selection":"selected","suspended_at":null,"token":"provider_canary"}
                        """, MediaType.APPLICATION_JSON));
        var result = client.findPersonalInstallation("alice").orElseThrow();
        assertThat(result.id()).isEqualTo(701);
        assertThat(result.account().id()).isEqualTo(101);
        assertThat(result.suspended()).isFalse();
        assertThat(result.toString()).doesNotContain("provider_canary");
        assertThat(output).doesNotContain("app_jwt_canary", "provider_canary");
        server.verify();
    }

    @Test
    void noInstallationReturnsEmptyWithoutMintingAnyToken() {
        server.expect(requestTo(API + "/users/alice/installation"))
                .andRespond(withStatus(HttpStatus.NOT_FOUND));
        assertThat(client.findPersonalInstallation("alice")).isEmpty();
        server.verify();
    }

    @Test
    void readsOnlySelectedInstallationWithMetadataOnlyTokenAndBoundedPage(CapturedOutput output) {
        expectToken(tokenResponse("\"metadata\":\"read\"", Instant.now().plusSeconds(3500).toString()));
        server.expect(requestTo(API + "/installation/repositories?per_page=30&page=2"))
                .andExpect(method(HttpMethod.GET))
                .andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer installation_token_canary"))
                .andRespond(withSuccess("""
                        {"total_count":61,"repositories":[
                          {"id":801,"owner":{"id":101,"login":"alice","type":"User"},
                           "name":"solutions","private":true,"default_branch":"main",
                           "token":"provider_canary","html_url":"https://untrusted.test",
                           "description":"private-description-canary"}
                        ]}
                        """, MediaType.APPLICATION_JSON));
        var result = client.listRepositories(701, 2);
        assertThat(result.hasMore()).isTrue();
        assertThat(result.repositories()).hasSize(1);
        assertThat(result.repositories().getFirst().privateRepository()).isTrue();
        assertThat(result.toString()).doesNotContain("canary", "untrusted");
        assertThat(output).doesNotContain("app_jwt_canary", "installation_token_canary",
                "provider_canary", "private-description-canary");
        server.verify();
    }

    @Test
    void emptyRepositoryPageIsSuccessfulAndDoesNotFetchCodeOrBranches() {
        expectToken(tokenResponse("\"metadata\":\"read\"", Instant.now().plusSeconds(3500).toString()));
        server.expect(requestTo(API + "/installation/repositories?per_page=30&page=1"))
                .andRespond(withSuccess("{\"total_count\":0,\"repositories\":[]}", MediaType.APPLICATION_JSON));
        var result = client.listRepositories(701, 1);
        assertThat(result.repositories()).isEmpty();
        assertThat(result.hasMore()).isFalse();
        server.verify();
    }

    @ParameterizedTest
    @ValueSource(strings = {"\"metadata\":\"read\",\"contents\":\"write\"", "\"contents\":\"read\"", ""})
    void rejectsBroaderOrMissingTokenPermissionsBeforeRepositoryRequest(String permissions) {
        expectToken(tokenResponse(permissions, Instant.now().plusSeconds(3500).toString()));
        assertSafeFailure(() -> client.listRepositories(701, 1), ErrorCode.EXTERNAL_API_ERROR);
        server.verify();
    }

    @ParameterizedTest
    @ValueSource(strings = {"2020-01-01T00:00:00Z", "2099-01-01T00:00:00Z", "expires-canary"})
    void rejectsExpiredUnboundedOrMalformedTokenBeforeRepositoryRequest(String expires) {
        expectToken(tokenResponse("\"metadata\":\"read\"", expires));
        assertSafeFailure(() -> client.listRepositories(701, 1), ErrorCode.EXTERNAL_API_ERROR);
        server.verify();
    }

    @ParameterizedTest
    @CsvSource({"401,GITHUB_INTEGRATION_UNAVAILABLE", "403,ACCESS_DENIED",
            "404,GITHUB_INTEGRATION_NOT_FOUND", "429,RATE_LIMITED",
            "500,EXTERNAL_API_ERROR", "302,EXTERNAL_API_ERROR"})
    void tokenErrorsAreSafeAndNeverRetried(int status, ErrorCode expected, CapturedOutput output) {
        server.expect(requestTo(API + "/app/installations/701/access_tokens"))
                .andRespond(withStatus(HttpStatus.valueOf(status))
                        .header(HttpHeaders.LOCATION, "https://untrusted.test")
                        .body("provider_canary installation_token_canary"));
        assertSafeFailure(() -> client.listRepositories(701, 1), expected);
        assertThat(output).doesNotContain("provider_canary", "installation_token_canary", "app_jwt_canary");
        server.verify();
    }

    @ParameterizedTest
    @CsvSource({"X-RateLimit-Remaining,0", "Retry-After,60"})
    void recognizesPrimaryAndSecondaryRateLimitsWithoutSleepingOrRetry(String name, String value) {
        server.expect(requestTo(API + "/users/alice/installation"))
                .andRespond(withStatus(HttpStatus.FORBIDDEN).header(name, value));
        assertSafeFailure(() -> client.findPersonalInstallation("alice"), ErrorCode.RATE_LIMITED);
        server.verify();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "[]", "not-json-canary",
            "{\"id\":701,\"account\":{\"id\":101,\"login\":\"alice\",\"type\":\"User\"},\"repository_selection\":\"selected\"}"})
    void rejectsMalformedInstallationInsteadOfGuessingOwnership(String body) {
        server.expect(requestTo(API + "/users/alice/installation"))
                .andRespond(withSuccess(body, MediaType.APPLICATION_JSON));
        assertSafeFailure(() -> client.findPersonalInstallation("alice"), ErrorCode.EXTERNAL_API_ERROR);
        server.verify();
    }

    @Test
    void malformedRepositoryDoesNotBecomeAnEmptySuccess() {
        expectToken(tokenResponse("\"metadata\":\"read\"", Instant.now().plusSeconds(3500).toString()));
        server.expect(requestTo(API + "/installation/repositories?per_page=30&page=1"))
                .andRespond(withSuccess("{\"total_count\":1,\"repositories\":[{\"id\":801}]}",
                        MediaType.APPLICATION_JSON));
        assertSafeFailure(() -> client.listRepositories(701, 1), ErrorCode.EXTERNAL_API_ERROR);
        server.verify();
    }

    @Test
    void invalidLoginCannotChangeTheProviderRequestPath() {
        assertSafeFailure(() -> client.findPersonalInstallation("../orgs/other"),
                ErrorCode.GITHUB_INTEGRATION_NOT_FOUND);
        server.verify();
    }

    private void expectToken(String body) {
        server.expect(requestTo(API + "/app/installations/701/access_tokens"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer app_jwt_canary"))
                .andExpect(content().json("{\"permissions\":{\"metadata\":\"read\"}}", true))
                .andRespond(withSuccess(body, MediaType.APPLICATION_JSON));
    }

    private static String tokenResponse(String permissions, String expires) {
        return "{\"token\":\"installation_token_canary\",\"expires_at\":\"" + expires
                + "\",\"permissions\":{" + permissions + "}}";
    }

    private static void assertSafeFailure(Runnable operation, ErrorCode expected) {
        assertThatThrownBy(operation::run).isInstanceOf(CodeArchiveException.class)
                .satisfies(failure -> {
                    assertThat(((CodeArchiveException) failure).getErrorCode()).isEqualTo(expected);
                    assertThat(failure.getMessage()).doesNotContain("canary", "untrusted");
                    assertThat(failure.getCause()).isNull();
                });
    }
}

