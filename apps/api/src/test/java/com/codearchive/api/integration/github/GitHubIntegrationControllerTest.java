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


    @ParameterizedTest
    @ValueSource(strings = {"/701/repositories/801/branches", "/701/repositories/801/tree"})
    void browseRequiresSessionAndRejectsAnotherAccountsInstallation(String suffix) throws Exception {
        mvc.perform(get(ROOT + suffix)).andExpect(status().isUnauthorized());
        mvc.perform(request(suffix, "bob-session").queryParam("branch", "main")
                        .queryParam("expectedCommitSha", "a".repeat(40)))
                .andExpect(status().isNotFound());
        verify(client, never()).listBranches(anyLong(), anyLong(), anyLong(), anyInt());
        verify(client, never()).readDirectory(anyLong(), anyLong(), anyLong(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void branchesUseServerOwnerAndReturnSafeMetadataWithPagination() throws Exception {
        when(client.listBranches(701, 801, 101, 2)).thenReturn(new GitHubAppClient.BranchPage(List.of(
                new GitHubAppClient.Branch("feature/풀이", "a".repeat(40), true, true)), true));
        mvc.perform(request("/701/repositories/801/branches", "alice-session")
                        .queryParam("page", "2").queryParam("ownerId", "102").queryParam("repo", "bob-secret"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store, private"))
                .andExpect(jsonPath("$.data.repositoryId").value("801"))
                .andExpect(jsonPath("$.data.page").value(2))
                .andExpect(jsonPath("$.data.hasMore").value(true))
                .andExpect(jsonPath("$.data.branches[0].name").value("feature/풀이"))
                .andExpect(jsonPath("$.data.branches[0].protected").value(true))
                .andExpect(jsonPath("$.data.branches[0].selectable").value(true));
        verify(client).listBranches(701, 801, 101, 2);
    }

    @ParameterizedTest
    @CsvSource({"'',0", "SWEA,1", "SWEA/1206,2"})
    void treeResponseBuildsBreadcrumbsAndKeepsTheVerifiedSnapshot(String path, int depth) throws Exception {
        String sha = "a".repeat(40);
        when(client.readDirectory(701, 801, 101, "main", sha, path))
                .thenReturn(new GitHubAppClient.Directory("main", sha, "b".repeat(40), "c".repeat(40), path, List.of()));
        var result = mvc.perform(request("/701/repositories/801/tree", "alice-session")
                        .queryParam("branch", "main").queryParam("expectedCommitSha", sha).queryParam("path", path))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.path").value(path))
                .andExpect(jsonPath("$.data.commitSha").value(sha))
                .andExpect(jsonPath("$.data.breadcrumbs.length()").value(depth + 1))
                .andExpect(jsonPath("$.data.breadcrumbs[0].path").value(""))
                .andExpect(jsonPath("$.data.entries").isEmpty())
                .andExpect(jsonPath("$.data.truncated").value(false));
        if (depth == 0) result.andExpect(jsonPath("$.data.parentPath").isEmpty());
        if (depth == 1) result.andExpect(jsonPath("$.data.parentPath").value(""));
        if (depth == 2) result.andExpect(jsonPath("$.data.parentPath").value("SWEA"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"/absolute", "../escape", "a/../b", "a/./b", "a//b", "a/", "C:/temp",
            "a\\b", "%2e%2e", "%252fetc", ".git/hooks", "a\ncanary", "a:stream", "a?.java",
            "trailing.", "trailing ", "1/2/3/4/5/6/7/8/9"})
    void unsafeDirectoryPathsAreRejectedBeforeOwnershipOrProviderCalls(String path) throws Exception {
        mvc.perform(request("/701/repositories/801/tree", "alice-session")
                        .queryParam("branch", "main").queryParam("expectedCommitSha", "a".repeat(40))
                        .queryParam("path", path))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        verifyNoInteractions(client);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "../main", "a//b", "a.lock", "a~1", "a^", "a:b", "a?b", "a*b",
            "@{1}", "-main", "/main", "main/", "a\\b", "a b", "a%2fb", "a\u202Eb"})
    void unsafeBranchReferencesAreRejectedBeforeProviderCalls(String branch) throws Exception {
        mvc.perform(request("/701/repositories/801/tree", "alice-session")
                        .queryParam("branch", branch).queryParam("expectedCommitSha", "a".repeat(40)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        verifyNoInteractions(client);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "main", "abcd", "../other", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
    void arbitraryOrMissingCommitCannotBeUsedToReadATree(String sha) throws Exception {
        mvc.perform(request("/701/repositories/801/tree", "alice-session")
                        .queryParam("branch", "main").queryParam("expectedCommitSha", sha))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(client);
    }

    @Test
    void excessiveUtf8PathOrBranchLengthFailsBeforeProviderCalls() throws Exception {
        for (var request : List.of(
                request("/701/repositories/801/tree", "alice-session").queryParam("branch", "가".repeat(86))
                        .queryParam("expectedCommitSha", "a".repeat(40)),
                request("/701/repositories/801/tree", "alice-session").queryParam("branch", "main")
                        .queryParam("expectedCommitSha", "a".repeat(40)).queryParam("path", "가".repeat(86)))) {
            mvc.perform(request).andExpect(status().isBadRequest());
        }
        verifyNoInteractions(client);
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "-1", "9223372036854775808", "bad"})
    void invalidRepositoryIdCannotReachTheProvider(String id) throws Exception {
        mvc.perform(request("/701/repositories/" + id + "/branches", "alice-session"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(client);
    }

    @ParameterizedTest
    @CsvSource({"GITHUB_REFERENCE_CHANGED,409", "GITHUB_REPOSITORY_STATE_UNAVAILABLE,409",
            "GITHUB_DIRECTORY_LIMIT_EXCEEDED,422", "GITHUB_PATH_NOT_FOUND,404"})
    void treeFailuresNeverReturnPartialDirectories(ErrorCode code, int statusCode) throws Exception {
        when(client.readDirectory(701, 801, 101, "main", "a".repeat(40), ""))
                .thenThrow(new CodeArchiveException(code));
        mvc.perform(request("/701/repositories/801/tree", "alice-session")
                        .queryParam("branch", "main").queryParam("expectedCommitSha", "a".repeat(40)))
                .andExpect(status().is(statusCode))
                .andExpect(jsonPath("$.error.code").value(code.name()))
                .andExpect(jsonPath("$.data").isEmpty())
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
