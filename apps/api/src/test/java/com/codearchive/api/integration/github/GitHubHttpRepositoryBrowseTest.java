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
import java.util.Collections;
import java.util.List;
import java.util.Map;

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
import org.springframework.test.json.JsonCompareMode;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.fasterxml.jackson.databind.ObjectMapper;

@ExtendWith(OutputCaptureExtension.class)
class GitHubHttpRepositoryBrowseTest {
    private static final String API = "https://api.github.com";
    private static final String REPO = API + "/repos/alice/solutions";
    private static final String COMMIT = "a".repeat(40);
    private static final String ROOT = "b".repeat(40);
    private static final String CHILD = "c".repeat(40);
    private static final String BLOB = "d".repeat(40);
    private static final String TOKEN = "ghs_1234_eyJhbGciOiJSUzI1NiJ9.payload-with_dash.signature";
    private static final ObjectMapper JSON = new ObjectMapper();
    private MockRestServiceServer server;
    private GitHubHttpAppClient client;
    private GitHubAppProperties properties;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        GitHubAppJwt jwt = mock(GitHubAppJwt.class);
        when(jwt.issue()).thenReturn("app-jwt-canary");
        properties = new GitHubAppProperties();
        properties.setContentsReadEnabled(true);
        client = new GitHubHttpAppClient(jwt, builder.build(), properties);
    }

    @Test
    void scopesToOneRepositoryAndReadsPagedBranchesWithoutFollowingUrls(CapturedOutput output) {
        access();
        server.expect(requestTo(REPO + "/branches?per_page=30&page=2"))
                .andExpect(method(HttpMethod.GET))
                .andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN))
                .andRespond(withSuccess(json(List.of(Map.of("name", "main",
                        "commit", Map.of("sha", COMMIT, "url", "https://untrusted.test/private-canary"),
                        "protected", true, "protection_url", "private-canary"))), MediaType.APPLICATION_JSON)
                        .header(HttpHeaders.LINK, "<https://untrusted.test>; rel=\"next\""));
        var result = client.listBranches(701, 801, 101, 2);
        assertThat(result.hasMore()).isTrue();
        assertThat(result.branches()).containsExactly(new GitHubAppClient.Branch("main", COMMIT, true, true));
        assertThat(result.toString()).doesNotContain("canary", TOKEN, "untrusted");
        assertThat(output).doesNotContain("app-jwt-canary", TOKEN, "private-canary");
        server.verify();
    }

    @Test
    void emptyRepositoryHasAnEmptyBranchPageWithoutCreatingABranch() {
        access();
        server.expect(requestTo(REPO + "/branches?per_page=30&page=1"))
                .andRespond(withSuccess("[]", MediaType.APPLICATION_JSON));
        var result = client.listBranches(701, 801, 101, 1);
        assertThat(result.branches()).isEmpty();
        assertThat(result.hasMore()).isFalse();
        server.verify();
    }

    @Test
    void unsupportedBranchNamesRemainVisibleButCannotBeSelected() {
        access();
        server.expect(requestTo(REPO + "/branches?per_page=30&page=1"))
                .andRespond(withSuccess(json(List.of(Map.of("name", "percent%branch",
                        "commit", Map.of("sha", COMMIT), "protected", false))), MediaType.APPLICATION_JSON));
        assertThat(client.listBranches(701, 801, 101, 1).branches().getFirst().selectable()).isFalse();
        server.verify();
    }

    @Test
    void directoryWalkUsesPinnedTreeShasAndHandlesSlashBranchesAndUnicodePaths(CapturedOutput output) {
        access();
        branch("feature/read-only", "feature%2Fread-only", COMMIT);
        tree(ROOT, false, List.of(entry("풀이 모음", "tree", "040000", CHILD)));
        tree(CHILD, false, List.of(
                entry("Solution.java", "blob", "100644", BLOB),
                entry("next", "tree", "040000", ROOT),
                entry("link", "blob", "120000", BLOB),
                entry("module", "commit", "160000", COMMIT)));
        var result = client.readDirectory(701, 801, 101, "feature/read-only", COMMIT, "풀이 모음");
        assertThat(result.commitSha()).isEqualTo(COMMIT);
        assertThat(result.rootTreeSha()).isEqualTo(ROOT);
        assertThat(result.treeSha()).isEqualTo(CHILD);
        assertThat(result.entries()).extracting(GitHubAppClient.TreeEntry::type).containsExactly(
                GitHubAppClient.EntryType.FILE, GitHubAppClient.EntryType.DIRECTORY,
                GitHubAppClient.EntryType.SYMLINK, GitHubAppClient.EntryType.SUBMODULE);
        assertThat(result.entries()).extracting(GitHubAppClient.TreeEntry::browsable)
                .containsExactly(false, true, false, false);
        assertThat(result.entries().getFirst().path()).isEqualTo("풀이 모음/Solution.java");
        assertThat(output).doesNotContain(TOKEN, "private-canary");
        server.verify();
    }

    @Test
    void emptyRootTreeIsSuccessfulWithoutFetchingAnyBlob() {
        access();
        branch("main", "main", COMMIT);
        tree(ROOT, false, List.of());
        var result = client.readDirectory(701, 801, 101, "main", COMMIT, "");
        assertThat(result.entries()).isEmpty();
        assertThat(result.path()).isEmpty();
        server.verify();
    }

    @Test
    void changedBranchFailsBeforeFetchingAnyTree() {
        access();
        branch("main", "main", BLOB);
        failure(() -> client.readDirectory(701, 801, 101, "main", COMMIT, ""),
                ErrorCode.GITHUB_REFERENCE_CHANGED);
        server.verify();
    }

    @ParameterizedTest
    @CsvSource({"blob,100644", "blob,120000", "commit,160000"})
    void filesSymlinksAndSubmodulesCannotBeTraversed(String type, String mode) {
        access();
        branch("main", "main", COMMIT);
        tree(ROOT, false, List.of(entry("target", type, mode, BLOB)));
        failure(() -> client.readDirectory(701, 801, 101, "main", COMMIT, "target"),
                ErrorCode.GITHUB_PATH_NOT_FOUND);
        server.verify();
    }

    @Test
    void missingDirectoryDoesNotBecomeAnEmptySuccess() {
        access();
        branch("main", "main", COMMIT);
        tree(ROOT, false, List.of());
        failure(() -> client.readDirectory(701, 801, 101, "main", COMMIT, "missing"),
                ErrorCode.GITHUB_PATH_NOT_FOUND);
        server.verify();
    }

    @Test
    void truncatedParentDoesNotProveThatAChildIsMissing() {
        access();
        branch("main", "main", COMMIT);
        tree(ROOT, true, List.of());
        failure(() -> client.readDirectory(701, 801, 101, "main", COMMIT, "missing"),
                ErrorCode.GITHUB_DIRECTORY_LIMIT_EXCEEDED);
        server.verify();
    }

    @Test
    void truncatedChildDoesNotReturnPartialEntries() {
        access();
        branch("main", "main", COMMIT);
        tree(ROOT, false, List.of(entry("folder", "tree", "040000", CHILD)));
        tree(CHILD, true, List.of(entry("partial.java", "blob", "100644", BLOB)));
        failure(() -> client.readDirectory(701, 801, 101, "main", COMMIT, "folder"),
                ErrorCode.GITHUB_DIRECTORY_LIMIT_EXCEEDED);
        server.verify();
    }

    @Test
    void applicationDirectoryLimitAlsoFailsClosed() {
        access();
        branch("main", "main", COMMIT);
        tree(ROOT, false, Collections.nCopies(1001, entry("file", "blob", "100644", BLOB)));
        failure(() -> client.readDirectory(701, 801, 101, "main", COMMIT, ""),
                ErrorCode.GITHUB_DIRECTORY_LIMIT_EXCEEDED);
        server.verify();
    }

    @ParameterizedTest
    @ValueSource(strings = {"duplicate", "mismatched-mode", "nested-path", "missing-truncated", "wrong-sha"})
    void malformedTreeCannotEstablishACompleteDirectory(String scenario) {
        access();
        branch("main", "main", COMMIT);
        Object body = switch (scenario) {
            case "duplicate" -> Map.of("sha", ROOT, "truncated", false,
                    "tree", List.of(entry("x", "blob", "100644", BLOB), entry("x", "blob", "100644", BLOB)));
            case "mismatched-mode" -> Map.of("sha", ROOT, "truncated", false,
                    "tree", List.of(entry("x", "blob", "040000", BLOB)));
            case "nested-path" -> Map.of("sha", ROOT, "truncated", false,
                    "tree", List.of(entry("x/y", "tree", "040000", CHILD)));
            case "missing-truncated" -> Map.of("sha", ROOT, "tree", List.of());
            default -> Map.of("sha", CHILD, "truncated", false, "tree", List.of());
        };
        server.expect(requestTo(REPO + "/git/trees/" + ROOT))
                .andRespond(withSuccess(json(body), MediaType.APPLICATION_JSON));
        failure(() -> client.readDirectory(701, 801, 101, "main", COMMIT, ""), ErrorCode.EXTERNAL_API_ERROR);
        server.verify();
    }

    @Test
    void unsafeNamesCanBeDisplayedButAreNotBrowsable() {
        access();
        branch("main", "main", COMMIT);
        tree(ROOT, false, List.of(entry(".git", "tree", "040000", CHILD),
                entry("unsafe%2Fname", "tree", "040000", CHILD)));
        assertThat(client.readDirectory(701, 801, 101, "main", COMMIT, "").entries())
                .extracting(GitHubAppClient.TreeEntry::browsable).containsExactly(false, false);
        server.verify();
    }

    @Test
    void disabledContentsGateDoesNotMintAToken() {
        properties.setContentsReadEnabled(false);
        failure(() -> client.listBranches(701, 801, 101, 1), ErrorCode.GITHUB_INTEGRATION_UNAVAILABLE);
        failure(() -> client.readDirectory(701, 801, 101, "main", COMMIT, ""),
                ErrorCode.GITHUB_INTEGRATION_UNAVAILABLE);
        server.verify();
    }

    @ParameterizedTest
    @CsvSource({"801,102,User,1", "802,101,User,1", "801,101,Organization,1",
            "801,101,User,2", "801,101,User,0"})
    void checksRepositoryIdentityOwnerAndExactTokenRepositoryCountBeforeBrowsing(
            long id, long ownerId, String type, long total) {
        token(Map.of("metadata", "read", "contents", "read"));
        repositories(total, List.of(repository(id, ownerId, type)));
        failure(() -> client.listBranches(701, 801, 101, 1), ErrorCode.GITHUB_INTEGRATION_NOT_FOUND);
        server.verify();
    }

    @ParameterizedTest
    @ValueSource(strings = {"write", "missing", "extra"})
    void rejectsMissingOrBroaderPermissionsBeforeRepositoryResolution(String scenario) {
        Map<String, String> permissions = switch (scenario) {
            case "write" -> Map.of("metadata", "read", "contents", "write");
            case "missing" -> Map.of("metadata", "read");
            default -> Map.of("metadata", "read", "contents", "read", "issues", "read");
        };
        token(permissions);
        failure(() -> client.listBranches(701, 801, 101, 1), ErrorCode.EXTERNAL_API_ERROR);
        server.verify();
    }

    @ParameterizedTest
    @CsvSource({"401,GITHUB_INTEGRATION_UNAVAILABLE", "403,ACCESS_DENIED",
            "404,GITHUB_INTEGRATION_NOT_FOUND", "409,GITHUB_REPOSITORY_STATE_UNAVAILABLE",
            "429,RATE_LIMITED", "302,EXTERNAL_API_ERROR"})
    void browseErrorsAreSafeAndNeverRetried(int status, ErrorCode code, CapturedOutput output) {
        access();
        server.expect(requestTo(REPO + "/branches?per_page=30&page=1"))
                .andRespond(withStatus(HttpStatus.valueOf(status))
                        .header(HttpHeaders.LOCATION, "https://untrusted.test").body("private-canary " + TOKEN));
        failure(() -> client.listBranches(701, 801, 101, 1), code);
        assertThat(output).doesNotContain("private-canary", TOKEN);
        server.verify();
    }

    private void access() {
        token(Map.of("metadata", "read", "contents", "read"));
        repositories(1, List.of(repository(801, 101, "User")));
    }

    private void token(Map<String, String> permissions) {
        server.expect(requestTo(API + "/app/installations/701/access_tokens"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer app-jwt-canary"))
                .andExpect(content().json(json(Map.of("repository_ids", List.of(801),
                        "permissions", Map.of("metadata", "read", "contents", "read"))), JsonCompareMode.STRICT))
                .andRespond(withSuccess(json(Map.of("token", TOKEN,
                        "expires_at", Instant.now().plusSeconds(3500).toString(), "permissions", permissions)),
                        MediaType.APPLICATION_JSON));
    }

    private void repositories(long total, List<?> repositories) {
        server.expect(requestTo(API + "/installation/repositories?per_page=30&page=1"))
                .andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN))
                .andRespond(withSuccess(json(Map.of("total_count", total, "repositories", repositories)),
                        MediaType.APPLICATION_JSON));
    }

    private static Map<String, ?> repository(long id, long owner, String type) {
        return Map.of("id", id, "name", "solutions", "private", true, "default_branch", "main",
                "owner", Map.of("id", owner, "login", "alice", "type", type));
    }

    private void branch(String name, String encoded, String commit) {
        server.expect(requestTo(REPO + "/branches/" + encoded))
                .andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN))
                .andRespond(withSuccess(json(Map.of("name", name, "commit",
                        Map.of("sha", commit, "commit", Map.of("tree", Map.of("sha", ROOT),
                                "message", "private-canary")))), MediaType.APPLICATION_JSON));
    }

    private void tree(String sha, boolean truncated, List<?> entries) {
        server.expect(requestTo(REPO + "/git/trees/" + sha))
                .andExpect(method(HttpMethod.GET))
                .andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN))
                .andRespond(withSuccess(json(Map.of("sha", sha, "truncated", truncated, "tree", entries)),
                        MediaType.APPLICATION_JSON));
    }

    private static Map<String, String> entry(String name, String type, String mode, String sha) {
        return Map.of("path", name, "type", type, "mode", mode, "sha", sha, "url", "https://untrusted.test");
    }

    private static String json(Object value) {
        try { return JSON.writeValueAsString(value); }
        catch (Exception failure) { throw new IllegalStateException(failure); }
    }

    private static void failure(Runnable action, ErrorCode expected) {
        assertThatThrownBy(action::run).isInstanceOf(CodeArchiveException.class).satisfies(failure -> {
            assertThat(((CodeArchiveException) failure).getErrorCode()).isEqualTo(expected);
            assertThat(failure.getMessage()).doesNotContain("canary", TOKEN, "untrusted");
            assertThat(failure.getCause()).isNull();
        });
    }
}
