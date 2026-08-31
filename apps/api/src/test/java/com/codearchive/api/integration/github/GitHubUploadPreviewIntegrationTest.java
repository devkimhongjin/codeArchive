package com.codearchive.api.integration.github;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockCookie;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import com.codearchive.api.auth.oauth.GitHubUserProfile;
import com.codearchive.api.auth.security.ApiAuthenticationFilter;
import com.codearchive.api.auth.security.SecureTokenCodec;
import com.codearchive.api.auth.session.AuthSession;
import com.codearchive.api.auth.session.AuthSessionRepository;
import com.codearchive.api.auth.user.CodeArchiveUser;
import com.codearchive.api.auth.user.UserRepository;
import com.codearchive.api.solution.SolutionRepository;
import com.fasterxml.jackson.databind.ObjectMapper;

@SpringBootTest(properties = {"DB_PASSWORD=test-only",
        "codearchive.auth.dashboard-origin=https://codearchive-dashboard-beta.onrender.com"})
@AutoConfigureMockMvc
@Testcontainers
@ExtendWith(OutputCaptureExtension.class)
class GitHubUploadPreviewIntegrationTest {
    private static final String ENDPOINT = "/api/v1/integrations/github/upload-preview";
    private static final String COMMIT = "a".repeat(40), ROOT = "b".repeat(40), BLOB = "c".repeat(40);
    private static final String CODE = "// synthetic-source-canary 한글\r\nclass Main {}\r\n";
    private static final String DEFAULT_PATH = "SWEA/1206/Solution.java";
    @Container @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17-alpine");
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired UserRepository users;
    @Autowired AuthSessionRepository sessions;
    @Autowired SecureTokenCodec tokens;
    @Autowired SolutionRepository solutions;
    @Autowired JdbcTemplate db;
    @Autowired GitHubPreviewSolutionReader reader;
    @MockitoBean GitHubAppClient github;

    record Actor(UUID id, long githubId, String login, String token) {}
    @AfterEach void clean() { db.update("DELETE FROM users"); }

    @Test
    void privateCapturePreviewUsesExactServerSourceAndNeverMutatesArchiveOrPublishes(CapturedOutput output) throws Exception {
        var actor = actor(); UUID id = create(actor, true);
        var before = db.queryForMap("SELECT * FROM solutions WHERE id = ?", id);
        allow(actor, true, false, null, null);
        var payload = payload(id);
        payload.put("code", "forged-client-source"); payload.put("userId", UUID.randomUUID());
        payload.put("acceptedCapture", true); payload.put("communityPublic", true); payload.put("overwrite", true);
        byte[] bytes = CODE.getBytes(StandardCharsets.UTF_8);
        for (int attempt = 0; attempt < 2; attempt++) {
            request(actor, body(payload)).andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store, private"))
                    .andExpect(result -> assertThat(result.getResponse().getHeaders("Vary").stream()
                            .flatMap(value -> Arrays.stream(value.split(","))).map(String::trim).toList())
                            .contains("Origin", "Cookie", "Authorization"))
                    .andExpect(jsonPath("$.data.status").value("CREATE_PREVIEW"))
                    .andExpect(jsonPath("$.data.readOnly").value(true))
                    .andExpect(jsonPath("$.data.uploadEnabled").value(false))
                    .andExpect(jsonPath("$.data.diff.operation").value("ADD_FILE"))
                    .andExpect(jsonPath("$.data.diff.before").value(""))
                    .andExpect(jsonPath("$.data.diff.after").value(CODE))
                    .andExpect(jsonPath("$.data.file.path").value(DEFAULT_PATH))
                    .andExpect(jsonPath("$.data.file.byteLength").value(bytes.length))
                    .andExpect(jsonPath("$.data.file.sha256").value(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))))
                    .andExpect(jsonPath("$.data.commitMessage").value("Add SWEA 1206 solution"))
                    .andExpect(jsonPath("$.data.target.privateRepository").value(true))
                    .andExpect(jsonPath("$.data.target.repositoryId").value("801"))
                    .andExpect(jsonPath("$.data.blockers").isEmpty())
                    .andExpect(jsonPath("$.data.source.aiUsage").doesNotExist())
                    .andExpect(jsonPath("$.data.source.title").doesNotExist())
                    .andExpect(jsonPath("$.data.source.executionTime").doesNotExist())
                    .andExpect(jsonPath("$.data.previewToken").doesNotExist());
        }
        assertThat(db.queryForMap("SELECT * FROM solutions WHERE id = ?", id)).isEqualTo(before);
        assertThat(before.get("community_public")).isEqualTo(false);
        verify(github, times(2)).findPersonalInstallation(actor.login());
        verify(github, times(2)).inspectUploadTarget(701, 801, actor.githubId(), "main", COMMIT, DEFAULT_PATH);
        verifyNoMoreInteractions(github);
        assertThat(reader.find(actor.id(), id).orElseThrow().toString()).doesNotContain(CODE);
        assertThat(output).doesNotContain("synthetic-source-canary", "forged-client-source", actor.token());
    }

    @Test
    void unknownAndOtherAccountSolutionsAreIndistinguishableAndNeverReachGithub() throws Exception {
        var a = actor(); var b = actor(); UUID id = create(a, true);
        var other = payload(id);
        request(b, body(other)).andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("SOLUTION_NOT_FOUND"));
        other.put("solutionId", UUID.randomUUID());
        request(b, body(other)).andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("SOLUTION_NOT_FOUND"));
        verifyNoInteractions(github);
    }

    @Test
    void manualAcceptedAndEditedCapturesCannotForgeEligibility() throws Exception {
        var actor = actor(); UUID manual = create(actor, false), capture = create(actor, true);
        var forged = payload(manual); forged.put("acceptedCapture", true); forged.put("result", "ACCEPTED");
        request(actor, body(forged)).andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("GITHUB_PREVIEW_NOT_ELIGIBLE"));
        var old = payload(capture);
        db.update("UPDATE solutions SET code = 'synthetic edit', updated_at = updated_at + interval '1 second' WHERE id = ?", capture);
        request(actor, body(old)).andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("GITHUB_PREVIEW_SOURCE_CHANGED"));
        request(actor, body(payload(capture))).andExpect(status().isForbidden());
        assertThat(db.queryForObject("SELECT accepted_capture FROM solutions WHERE id = ?", Boolean.class, capture)).isFalse();
        verifyNoInteractions(github);
    }

    @ParameterizedTest
    @ValueSource(strings = {"edit-code", "edit-metadata", "delete", "revoke-provenance"})
    void changesDuringProviderLookupInvalidatePreviewWithoutHoldingADatabaseLock(String change, CapturedOutput output) throws Exception {
        var actor = actor(); UUID id = create(actor, true); var payload = payload(id);
        allow(actor, true, false, null, null);
        when(github.inspectUploadTarget(anyLong(), anyLong(), anyLong(), anyString(), anyString(), anyString())).thenAnswer(call -> {
            // Separate connection/thread: an accidental source lock across I/O would time out this mutation.
            try (var executor = Executors.newSingleThreadExecutor()) {
                executor.submit(() -> {
                    var concurrent = new JdbcTemplate(Objects.requireNonNull(db.getDataSource()));
                    concurrent.setQueryTimeout(3);
                    switch (change) {
                        case "edit-code" -> concurrent.update("UPDATE solutions SET code = 'concurrent-source-canary' WHERE id = ?", id);
                        case "edit-metadata" -> concurrent.update("UPDATE solutions SET title = 'New title', updated_at = updated_at + interval '1 second' WHERE id = ?", id);
                        case "delete" -> concurrent.update("DELETE FROM solutions WHERE id = ?", id);
                        default -> concurrent.update("UPDATE solutions SET accepted_capture = FALSE WHERE id = ?", id);
                    }
                }).get(5, TimeUnit.SECONDS);
            }
            return target(actor, true, false, null, null);
        });
        request(actor, body(payload)).andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("GITHUB_PREVIEW_SOURCE_CHANGED"))
                .andExpect(jsonPath("$.data").isEmpty());
        assertThat(output).doesNotContain("synthetic-source-canary", "concurrent-source-canary");
    }

    @ParameterizedTest
    @ValueSource(strings = {"protected", "file", "directory", "symlink", "submodule", "parent", "protected-file"})
    void protectedBranchesAndAllPathCollisionsBlockEvenWhenOverwriteIsRequested(String collision) throws Exception {
        var actor = actor(); UUID id = create(actor, true);
        boolean protectedBranch = collision.startsWith("protected");
        var type = switch (collision) {
            case "directory" -> GitHubAppClient.EntryType.DIRECTORY;
            case "symlink" -> GitHubAppClient.EntryType.SYMLINK;
            case "submodule" -> GitHubAppClient.EntryType.SUBMODULE;
            default -> GitHubAppClient.EntryType.FILE;
        };
        var entry = new GitHubAppClient.TreeEntry("Solution.java", DEFAULT_PATH, type, BLOB, false);
        boolean parent = collision.equals("parent"), existing = !parent && !collision.equals("protected");
        allow(actor, true, protectedBranch, existing ? entry : null, parent ? entry : null);
        var payload = payload(id); payload.put("overwrite", true);
        var result = request(actor, body(payload)).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("BLOCKED"))
                .andExpect(jsonPath("$.data.uploadEnabled").value(false))
                .andExpect(jsonPath("$.data.diff").isEmpty()).andReturn();
        var blockers = json.readTree(result.getResponse().getContentAsString()).path("data").path("blockers");
        var expected = new ArrayList<String>();
        if (protectedBranch) expected.add("PROTECTED_BRANCH");
        if (parent) expected.add("PARENT_NOT_DIRECTORY");
        if (existing) expected.add("PATH_EXISTS");
        assertThat(json.convertValue(blockers, List.class)).isEqualTo(expected);
    }

    @Test
    void publicRepositoryDisclosureAndCustomOutputDoNotChangeCommunityVisibility() throws Exception {
        var actor = actor(); UUID id = create(actor, true); allow(actor, false, false, null, null);
        var payload = payload(id); payload.put("path", "풀이 모음/Custom.java"); payload.put("commitMessage", "풀이 추가");
        request(actor, body(payload)).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.target.privateRepository").value(false))
                .andExpect(jsonPath("$.data.file.path").value("풀이 모음/Custom.java"))
                .andExpect(jsonPath("$.data.commitMessage").value("풀이 추가"))
                .andExpect(jsonPath("$.data.disclosureNotice").value(org.hamcrest.Matchers.containsString("공개 저장소")));
        assertThat(db.queryForObject("SELECT community_public FROM solutions WHERE id = ?", Boolean.class, id)).isFalse();
        verify(github).inspectUploadTarget(701, 801, actor.githubId(), "main", COMMIT, "풀이 모음/Custom.java");
    }

    @Test
    void installationMustBelongToCurrentServerAccountBeforeTargetInspection() throws Exception {
        var a = actor(); var b = actor(); UUID id = create(b, true);
        when(github.findPersonalInstallation(b.login())).thenReturn(Optional.of(new GitHubAppClient.Installation(
                701, new GitHubAppClient.Account(a.githubId(), a.login(), "User"), "selected", false)));
        request(b, body(payload(id))).andExpect(status().isNotFound());
        verify(github).findPersonalInstallation(b.login()); verifyNoMoreInteractions(github);
    }

    @Test
    void cookiePostRequiresApprovedOriginAndMixedCredentialsAreDenied() throws Exception {
        var actor = actor(); UUID id = create(actor, true); var payload = payload(id);
        var cookie = new MockCookie(ApiAuthenticationFilter.SESSION_COOKIE_NAME, actor.token());
        mvc.perform(body(payload)).andExpect(status().isUnauthorized());
        mvc.perform(body(payload).cookie(cookie)).andExpect(status().isForbidden());
        mvc.perform(body(payload).cookie(cookie).header("Origin", "https://untrusted.test")).andExpect(status().isForbidden());
        mvc.perform(body(payload).cookie(cookie).header("Authorization", "Bearer " + actor.token())
                .header("Origin", "https://codearchive-dashboard-beta.onrender.com")).andExpect(status().isUnauthorized());
        verifyNoInteractions(github);
        allow(actor, true, false, null, null);
        mvc.perform(body(payload).cookie(cookie).header("Origin", "https://codearchive-dashboard-beta.onrender.com"))
                .andExpect(status().isOk());
    }

    @Test
    void invalidSelectorsVersionsPathsAndMessagesAreRejectedBeforeProviderCalls() throws Exception {
        var actor = actor(); UUID id = create(actor, true); var valid = payload(id);
        Map<String, Object> invalid = Map.of("solutionId", "not-uuid", "expectedUpdatedAt", "not-time",
                "installationId", 0, "repositoryId", -1, "branch", "../main", "expectedCommitSha", "not-sha",
                "path", "../Solution.java", "commitMessage", "message\nsecret");
        for (var entry : invalid.entrySet()) {
            var payload = new HashMap<>(valid); payload.put(entry.getKey(), entry.getValue());
            request(actor, body(payload)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.data").isEmpty());
        }
        for (String required : List.of("solutionId", "expectedUpdatedAt", "installationId", "repositoryId", "branch", "expectedCommitSha")) {
            var payload = new HashMap<>(valid); payload.remove(required);
            request(actor, body(payload)).andExpect(status().isBadRequest());
        }
        verifyNoInteractions(github);
    }

    private Actor actor() {
        Instant now = Instant.now(); long githubId = UUID.randomUUID().getMostSignificantBits() & Long.MAX_VALUE;
        String login = "u" + githubId;
        var user = users.save(CodeArchiveUser.create(new GitHubUserProfile(githubId, login, "Synthetic", null), now));
        String token = UUID.randomUUID().toString();
        sessions.save(AuthSession.create(user.getId(), tokens.hash(token), now.plusSeconds(3600), now));
        return new Actor(user.getId(), githubId, login, token);
    }

    private UUID create(Actor actor, boolean captured) throws Exception {
        String client = UUID.randomUUID().toString(); var p = new HashMap<String, Object>();
        p.put("clientRecordId", client); p.put("platform", "SWEA"); p.put("problemNumber", "1206");
        p.put("title", "Synthetic title never exported"); p.put("language", "Java"); p.put("code", CODE);
        p.put("result", "ACCEPTED"); p.put("solvedAt", "2026-08-30T01:00:00Z");
        p.put("observedAt", "2026-08-30T01:00:01Z"); p.put("aiUsage", "unknown");
        var builder = captured ? post("/api/v1/solutions/bulk-upsert") : put("/api/v1/solutions/by-client-id/{id}", client);
        request(actor, builder.contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(captured ? Map.of("records", List.of(p)) : p))).andExpect(status().isOk());
        return solutions.findByUserIdAndClientRecordId(actor.id(), client).orElseThrow().getId();
    }

    private Map<String, Object> payload(UUID id) {
        var p = new HashMap<String, Object>(); p.put("solutionId", id);
        p.put("expectedUpdatedAt", db.queryForObject("SELECT updated_at FROM solutions WHERE id = ?", Timestamp.class, id).toInstant());
        p.put("installationId", 701); p.put("repositoryId", 801); p.put("branch", "main"); p.put("expectedCommitSha", COMMIT);
        return p;
    }

    private MockHttpServletRequestBuilder body(Map<String, Object> payload) throws Exception {
        return post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(payload));
    }
    private ResultActions request(Actor a, MockHttpServletRequestBuilder builder) throws Exception {
        return mvc.perform(builder.header("Authorization", "Bearer " + a.token()));
    }
    private void allow(Actor a, boolean privateRepo, boolean protectedBranch,
            GitHubAppClient.TreeEntry entry, GitHubAppClient.TreeEntry obstruction) {
        when(github.findPersonalInstallation(a.login())).thenReturn(Optional.of(new GitHubAppClient.Installation(
                701, new GitHubAppClient.Account(a.githubId(), a.login(), "User"), "selected", false)));
        when(github.inspectUploadTarget(eq(701L), eq(801L), eq(a.githubId()), eq("main"), eq(COMMIT), anyString()))
                .thenReturn(target(a, privateRepo, protectedBranch, entry, obstruction));
    }
    private GitHubAppClient.UploadTarget target(Actor a, boolean privateRepo, boolean protectedBranch,
            GitHubAppClient.TreeEntry entry, GitHubAppClient.TreeEntry obstruction) {
        var repository = new GitHubAppClient.Repository(801, new GitHubAppClient.Account(a.githubId(), a.login(), "User"),
                "solutions", privateRepo, "main");
        return new GitHubAppClient.UploadTarget(repository, "main", COMMIT, ROOT, protectedBranch, List.of(), entry, obstruction);
    }
}
