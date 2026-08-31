package com.codearchive.api.integration.github;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.codearchive.api.auth.AuthService;
import com.codearchive.api.auth.config.SecurityConfig;
import com.codearchive.api.auth.oauth.GitHubUserProfile;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.auth.security.ApiAuthenticationFilter;
import com.codearchive.api.auth.user.CodeArchiveUser;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.codearchive.api.common.filter.RequestIdFilter;
import jakarta.servlet.http.Cookie;

@WebMvcTest(controllers = GitHubIntegrationController.class,
        properties = "codearchive.auth.dashboard-origin=https://codearchive-dashboard-beta.onrender.com")
@Import({SecurityConfig.class, GitHubIntegrationService.class})
class GitHubIntegrationControllerTest {
    private static final String ROOT = "/api/v1/integrations/github/installations";
    private static final GitHubAppClient.Account ALICE = new GitHubAppClient.Account(101, "alice", "User");
    private static final GitHubAppClient.Account BOB = new GitHubAppClient.Account(102, "bob", "User");

    @Autowired MockMvc mvc;
    @MockitoBean AuthService authService;
    @MockitoBean GitHubAppClient client;

    @BeforeEach
    void setUp() {
        actor("alice-session", 101, "alice");
        actor("bob-session", 102, "bob");
        when(client.findPersonalInstallation("alice"))
                .thenReturn(Optional.of(installation(701, ALICE, false)));
        when(client.findPersonalInstallation("bob"))
                .thenReturn(Optional.of(installation(702, BOB, false)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "/701/repositories"})
    void missingAndInvalidSessionsCannotCallTheProvider(String suffix) throws Exception {
        mvc.perform(get(ROOT + suffix)).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_REQUIRED"));
        mvc.perform(request(suffix, "expired-session")).andExpect(status().isUnauthorized());
        verifyNoInteractions(client);
    }

    @Test
    void dashboardCookieUsesSameOwnershipRulesAndMixedCredentialsAreRejected() throws Exception {
        mvc.perform(get(ROOT).cookie(new Cookie(ApiAuthenticationFilter.SESSION_COOKIE_NAME, "alice-session"))
                        .header(HttpHeaders.ORIGIN, "https://codearchive-dashboard-beta.onrender.com")
                        .requestAttr(RequestIdFilter.REQUEST_ID_ATTRIBUTE, "github-read-test"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN,
                        "https://codearchive-dashboard-beta.onrender.com"))
                .andExpect(jsonPath("$.data.installations[0].account.id").value("101"));
        mvc.perform(request("/701/repositories", "alice-session")
                        .cookie(new Cookie(ApiAuthenticationFilter.SESSION_COOKIE_NAME, "bob-session")))
                .andExpect(status().isUnauthorized());
        verify(client, never()).listRepositories(anyLong(), anyInt());
    }

    @Test
    void unapprovedOriginCannotUseTheNewReadEndpoints() throws Exception {
        mvc.perform(get(ROOT).cookie(new Cookie(ApiAuthenticationFilter.SESSION_COOKIE_NAME, "alice-session"))
                        .header(HttpHeaders.ORIGIN, "https://unapproved.example"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(client);
    }

    @Test
    void returnsOnlyServerResolvedAccountWithNoClientOwnershipOverride() throws Exception {
        mvc.perform(request("", "alice-session").queryParam("userId", "102")
                        .queryParam("owner", "bob"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store, private"))
                .andExpect(jsonPath("$.data.installations.length()").value(1))
                .andExpect(jsonPath("$.data.installations[0].id").value("701"))
                .andExpect(jsonPath("$.data.installations[0].account.id").value("101"))
                .andExpect(jsonPath("$.data.installations[0].account.login").value("alice"))
                .andExpect(jsonPath("$.data.installations[0].repositorySelection").value("selected"))
                .andExpect(jsonPath("$.data.token").doesNotExist());
        verify(client, never()).findPersonalInstallation("bob");
    }

    @Test
    void otherAccountInstallationAndUnknownInstallationHaveSame404WithoutTokenMint() throws Exception {
        for (String id : List.of("701", "999")) {
            mvc.perform(request("/" + id + "/repositories", "bob-session"))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.error.code").value("GITHUB_INTEGRATION_NOT_FOUND"));
        }
        verify(client, never()).listRepositories(anyLong(), anyInt());
    }

    @Test
    void filtersOtherOwnersAndOrganizationsAndReturnsOnlySafeRepositoryMetadata() throws Exception {
        when(client.listRepositories(701, 1)).thenReturn(new GitHubAppClient.RepositoryPage(List.of(
                new GitHubAppClient.Repository(801, ALICE, "solutions", true, "main"),
                new GitHubAppClient.Repository(802, BOB, "bob-private", true, "secret-branch"),
                new GitHubAppClient.Repository(803,
                        new GitHubAppClient.Account(101, "alice", "Organization"), "org", true, "main")), true));
        mvc.perform(request("/701/repositories", "alice-session"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.installationId").value("701"))
                .andExpect(jsonPath("$.data.page").value(1))
                .andExpect(jsonPath("$.data.perPage").value(30))
                .andExpect(jsonPath("$.data.hasMore").value(true))
                .andExpect(jsonPath("$.data.repositories.length()").value(1))
                .andExpect(jsonPath("$.data.repositories[0].id").value("801"))
                .andExpect(jsonPath("$.data.repositories[0].private").value(true))
                .andExpect(jsonPath("$.data.repositories[0].htmlUrl").value("https://github.com/alice/solutions"))
                .andExpect(content().string(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("bob-private"))))
                .andExpect(content().string(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("secret-branch"))));
    }

    @Test
    void resolvesOwnershipAgainAfterUninstallInsteadOfReusingPriorSuccess() throws Exception {
        mvc.perform(request("", "alice-session")).andExpect(status().isOk());
        when(client.findPersonalInstallation("alice")).thenReturn(Optional.empty());
        mvc.perform(request("/701/repositories", "alice-session")).andExpect(status().isNotFound());
        mvc.perform(request("", "alice-session"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.installations").isEmpty());
        verify(client, never()).listRepositories(anyLong(), anyInt());
    }

    @ParameterizedTest
    @CsvSource({"102,User,false", "101,Organization,false", "101,User,true"})
    void reusedLoginOrganizationOrSuspendedInstallationNeverGrantsAccess(
            long accountId, String type, boolean suspended) throws Exception {
        when(client.findPersonalInstallation("alice")).thenReturn(Optional.of(installation(701,
                new GitHubAppClient.Account(accountId, "alice", type), suspended)));
        mvc.perform(request("", "alice-session"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.installations").isEmpty());
        mvc.perform(request("/701/repositories", "alice-session")).andExpect(status().isNotFound());
        verify(client, never()).listRepositories(anyLong(), anyInt());
    }

    @Test
    void accountSwitchUsesNewPrincipalAndNeverReusesOldInstallation() throws Exception {
        when(client.listRepositories(701, 1)).thenReturn(new GitHubAppClient.RepositoryPage(List.of(), false));
        when(client.listRepositories(702, 2)).thenReturn(new GitHubAppClient.RepositoryPage(List.of(), false));
        mvc.perform(request("/701/repositories", "alice-session")).andExpect(status().isOk());
        mvc.perform(request("/701/repositories", "bob-session")).andExpect(status().isNotFound());
        mvc.perform(request("/702/repositories", "bob-session").queryParam("page", "2"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.installationId").value("702"))
                .andExpect(jsonPath("$.data.page").value(2));
        verify(client).listRepositories(701, 1);
        verify(client).listRepositories(702, 2);
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "-1", "10001", "2147483648", "invalid-canary"})
    void malformedPagesFailBeforeProviderCalls(String page) throws Exception {
        mvc.perform(request("/701/repositories", "alice-session").queryParam("page", page))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        verifyNoInteractions(client);
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "-1", "9223372036854775808", "invalid-canary"})
    void malformedInstallationIdsFailBeforeProviderCalls(String id) throws Exception {
        mvc.perform(request("/" + id + "/repositories", "alice-session"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        verifyNoInteractions(client);
    }

    @ParameterizedTest
    @CsvSource({"GITHUB_INTEGRATION_UNAVAILABLE,503", "ACCESS_DENIED,403",
            "GITHUB_INTEGRATION_NOT_FOUND,404", "RATE_LIMITED,429", "EXTERNAL_API_ERROR,502"})
    void providerFailuresKeepCodeArchiveSessionAndUseSafeEnvelope(ErrorCode code, int statusCode) throws Exception {
        when(client.findPersonalInstallation("alice")).thenThrow(new CodeArchiveException(code));
        mvc.perform(request("", "alice-session"))
                .andExpect(status().is(statusCode))
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.data").isEmpty())
                .andExpect(jsonPath("$.error.code").value(code.name()))
                .andExpect(jsonPath("$.requestId").value("github-read-test"))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL,
                        org.hamcrest.Matchers.containsString("no-store")))
                .andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE));
    }

    private void actor(String token, long githubId, String login) {
        CodeArchiveUser user = CodeArchiveUser.create(
                new GitHubUserProfile(githubId, login, login, null), Instant.now());
        // Stale login in the principal is deliberately ignored in favor of the current server user.
        CodeArchivePrincipal principal = new CodeArchivePrincipal(user.getId(), UUID.randomUUID(), "stale-login");
        when(authService.authenticate(token)).thenReturn(Optional.of(principal));
        when(authService.currentUser(principal)).thenReturn(user);
    }

    private static GitHubAppClient.Installation installation(
            long id, GitHubAppClient.Account account, boolean suspended) {
        return new GitHubAppClient.Installation(id, account, "selected", suspended);
    }

    private static MockHttpServletRequestBuilder request(String suffix, String token) {
        return get(ROOT + suffix).header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .requestAttr(RequestIdFilter.REQUEST_ID_ATTRIBUTE, "github-read-test")
                .header(RequestIdFilter.REQUEST_ID_HEADER, "github-read-test");
    }
}
