package com.codearchive.api.integration.github;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.system.*;
import org.springframework.http.*;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.test.json.JsonCompareMode;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import com.codearchive.api.common.exception.*;
import com.fasterxml.jackson.databind.ObjectMapper;

@ExtendWith(OutputCaptureExtension.class)
class GitHubHttpCommitTest {
    static final String API = "https://api.github.com", REPO = API + "/repos/alice/solutions";
    static final String HEAD = "a".repeat(40), ROOT = "b".repeat(40), CHILD = "c".repeat(40), COMMIT = "d".repeat(40);
    static final String REF = "REF_synthetic", TOKEN = "ghs_synthetic.write-token", CODE = "// source-canary 한글\r\nclass Main {}\r\n";
    static final ObjectMapper JSON = new ObjectMapper();
    MockRestServiceServer server; GitHubHttpAppClient client; GitHubAppProperties properties;
    @BeforeEach void setup() {
        var builder = RestClient.builder(); server = MockRestServiceServer.bindTo(builder).build();
        var jwt = mock(GitHubAppJwt.class); when(jwt.issue()).thenReturn("synthetic-app-jwt");
        properties = new GitHubAppProperties(); properties.setContentsReadEnabled(true); properties.setContentsWriteEnabled(true);
        client = new GitHubHttpAppClient(jwt, builder.build(), properties);
    }

    @Test void usesScopedWriteTokenPinnedRefAndAtomicExpectedHeadWithOneExactAddition(CapturedOutput output) {
        prepareExpectations();
        mutation().andRespond(withSuccess(json(result(HEAD, REF)), MediaType.APPLICATION_JSON));
        var ready = client.prepareCommit(selection());
        assertThat(ready.toString()).doesNotContain(TOKEN, "alice");
        var result = ready.create(CODE, "Reviewed message");
        assertThat(result.sha()).isEqualTo(COMMIT);
        assertThat(result.url()).isEqualTo("https://github.com/alice/solutions/commit/" + COMMIT);
        error(() -> ready.create(CODE, "Reviewed message"), ErrorCode.GITHUB_UPLOAD_ALREADY_ATTEMPTED);
        assertThat(output).doesNotContain(CODE, TOKEN, "synthetic-app-jwt", "provider-body-canary");
        server.verify();
    }

    @ParameterizedTest @ValueSource(strings = {"timeout", "401", "403", "404", "409", "429", "500", "302",
            "graphql-error", "partial", "wrong-parent", "wrong-ref", "malformed"})
    void everyAmbiguousMutationOutcomeIsSanitizedAndNeverRetried(String scenario, CapturedOutput output) {
        prepareExpectations(); var expectation = mutation();
        switch (scenario) {
            case "timeout" -> expectation.andRespond(withException(new SocketTimeoutException("provider-body-canary")));
            case "graphql-error" -> expectation.andRespond(withSuccess("{\"errors\":[{\"message\":\"provider-body-canary\"}]}", MediaType.APPLICATION_JSON));
            case "partial" -> expectation.andRespond(withSuccess("{\"data\":null,\"errors\":[{}]}", MediaType.APPLICATION_JSON));
            case "wrong-parent" -> expectation.andRespond(withSuccess(json(result(ROOT, REF)), MediaType.APPLICATION_JSON));
            case "wrong-ref" -> expectation.andRespond(withSuccess(json(result(HEAD, "REF_other")), MediaType.APPLICATION_JSON));
            case "malformed" -> expectation.andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));
            default -> expectation.andRespond(withStatus(HttpStatus.valueOf(Integer.parseInt(scenario)))
                    .header(HttpHeaders.LOCATION, "https://untrusted.test").body("provider-body-canary " + TOKEN));
        }
        var ready = client.prepareCommit(selection());
        error(() -> ready.create(CODE, "Reviewed message"), ErrorCode.GITHUB_UPLOAD_OUTCOME_UNKNOWN);
        error(() -> ready.create(CODE, "Reviewed message"), ErrorCode.GITHUB_UPLOAD_ALREADY_ATTEMPTED);
        assertThat(output).doesNotContain("provider-body-canary", TOKEN, "source-canary");
        server.verify();
    }

    @ParameterizedTest @ValueSource(strings = {"privacy", "owner", "rename", "protected", "collision", "truncated", "stale", "late-privacy", "late-protected", "ref-mismatch"})
    void unsafeOrChangedTargetNeverReturnsASourceSendingCapability(String scenario) {
        token("write");
        repository(!scenario.equals("privacy"), scenario.equals("owner") ? 102 : 101, scenario.equals("rename") ? "renamed" : "solutions");
        ErrorCode expected = scenario.equals("owner") ? ErrorCode.GITHUB_INTEGRATION_NOT_FOUND : ErrorCode.GITHUB_UPLOAD_TARGET_CHANGED;
        if (!Set.of("privacy", "owner", "rename").contains(scenario)) {
            branch(scenario.equals("stale") ? COMMIT : HEAD, scenario.equals("protected"));
            if (scenario.equals("stale")) expected = ErrorCode.GITHUB_REFERENCE_CHANGED;
            else {
                trees(scenario.equals("collision"), scenario.equals("truncated"));
                if (scenario.equals("truncated")) expected = ErrorCode.GITHUB_DIRECTORY_LIMIT_EXCEEDED;
                else if (!Set.of("protected", "collision").contains(scenario)) {
                    ref(scenario.equals("ref-mismatch") ? COMMIT : HEAD);
                    if (!scenario.equals("ref-mismatch")) {
                        repository(!scenario.equals("late-privacy"), 101, "solutions");
                        if (!scenario.equals("late-privacy")) branch(HEAD, true);
                    }
                }
            }
        }
        error(() -> client.prepareCommit(selection()), expected);
        server.verify();
    }

    @Test void writeGateAndInsufficientTokenGrantFailBeforeRepositoryReads() {
        properties.setContentsWriteEnabled(false);
        error(() -> client.prepareCommit(selection()), ErrorCode.GITHUB_INTEGRATION_UNAVAILABLE);
        properties.setContentsWriteEnabled(true);
        token("read");
        error(() -> client.prepareCommit(selection()), ErrorCode.EXTERNAL_API_ERROR);
        server.verify();
    }

    @Test void disablingWriteAfterPreparationStillPreventsSourceTransmission() {
        prepareExpectations(); var ready = client.prepareCommit(selection());
        properties.setContentsWriteEnabled(false);
        error(() -> ready.create(CODE, "Reviewed message"), ErrorCode.GITHUB_INTEGRATION_UNAVAILABLE);
        server.verify();
    }

    private GitHubAppClient.CommitSelection selection() {
        return new GitHubAppClient.CommitSelection(701, 801, 101, "feature/upload", HEAD, "풀이/Solution.java", true, "alice/solutions");
    }
    private void prepareExpectations() {
        token("write"); repository(true, 101, "solutions"); branch(HEAD, false); trees(false, false);
        ref(HEAD); repository(true, 101, "solutions"); branch(HEAD, false);
    }
    private void token(String grant) {
        server.expect(requestTo(API + "/app/installations/701/access_tokens")).andExpect(method(HttpMethod.POST))
                .andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer synthetic-app-jwt"))
                .andExpect(content().json(json(Map.of("repository_ids", List.of(801), "permissions", Map.of("metadata", "read", "contents", "write"))), JsonCompareMode.STRICT))
                .andRespond(withSuccess(json(Map.of("token", TOKEN, "expires_at", Instant.now().plusSeconds(3500).toString(),
                        "permissions", Map.of("metadata", "read", "contents", grant))), MediaType.APPLICATION_JSON));
    }
    private void repository(boolean privateRepo, long owner, String name) {
        get(API + "/installation/repositories?per_page=30&page=1", Map.of("total_count", 1, "repositories", List.of(Map.of(
                "id", 801, "name", name, "private", privateRepo, "default_branch", "main",
                "owner", Map.of("id", owner, "login", "alice", "type", "User")))));
    }
    private void branch(String head, boolean protectedBranch) {
        get(REPO + "/branches/feature%2Fupload", Map.of("name", "feature/upload", "protected", protectedBranch,
                "commit", Map.of("sha", head, "commit", Map.of("tree", Map.of("sha", ROOT)))));
    }
    private void trees(boolean collision, boolean truncated) {
        get(REPO + "/git/trees/" + ROOT, Map.of("sha", ROOT, "truncated", truncated,
                "tree", List.of(Map.of("path", "풀이", "type", "tree", "mode", "040000", "sha", CHILD))));
        if (!truncated) get(REPO + "/git/trees/" + CHILD, Map.of("sha", CHILD, "truncated", false, "tree", collision
                ? List.of(Map.of("path", "Solution.java", "type", "blob", "mode", "100644", "sha", COMMIT)) : List.of()));
    }
    private void ref(String head) {
        get(REPO + "/git/ref/heads/feature%2Fupload", Map.of("ref", "refs/heads/feature/upload", "node_id", REF,
                "object", Map.of("type", "commit", "sha", head)));
    }
    private void get(String url, Object response) {
        server.expect(requestTo(url)).andExpect(method(HttpMethod.GET)).andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN))
                .andRespond(withSuccess(json(response), MediaType.APPLICATION_JSON));
    }
    private org.springframework.test.web.client.ResponseActions mutation() {
        return server.expect(requestTo(API + "/graphql")).andExpect(method(HttpMethod.POST))
                .andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer " + TOKEN))
                .andExpect(request -> {
                    var sent = JSON.readTree(((MockClientHttpRequest) request).getBodyAsString());
                    assertThat(sent.path("query").asText()).contains("createCommitOnBranch").doesNotContain("source-canary", "Reviewed message", "alice");
                    var expected = Map.of("branch", Map.of("id", REF), "expectedHeadOid", HEAD, "message", Map.of("headline", "Reviewed message"),
                            "fileChanges", Map.of("additions", List.of(Map.of("path", "풀이/Solution.java",
                                    "contents", Base64.getEncoder().encodeToString(CODE.getBytes(StandardCharsets.UTF_8))))));
                    assertThat(sent.path("variables").path("input")).isEqualTo(JSON.valueToTree(expected));
                });
    }
    private Object result(String parent, String ref) {
        return Map.of("data", Map.of("createCommitOnBranch", Map.of(
                "commit", Map.of("oid", COMMIT, "parents", Map.of("nodes", List.of(Map.of("oid", parent)))),
                "ref", Map.of("id", ref, "name", "feature/upload", "prefix", "refs/heads/", "url", "https://untrusted.test"))));
    }
    private static String json(Object value) {
        try { return JSON.writeValueAsString(value); } catch (Exception e) { throw new IllegalStateException(e); }
    }
    private void error(Runnable action, ErrorCode expected) {
        assertThatThrownBy(action::run).isInstanceOf(CodeArchiveException.class).satisfies(failure -> {
            assertThat(((CodeArchiveException) failure).getErrorCode()).isEqualTo(expected);
            assertThat(failure.getMessage()).doesNotContain("provider-body-canary", TOKEN, "source-canary");
            assertThat(failure.getCause()).isNull();
        });
    }
}
