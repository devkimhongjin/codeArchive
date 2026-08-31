package com.codearchive.api.integration.github;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockCookie;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;
import com.codearchive.api.auth.oauth.GitHubUserProfile;
import com.codearchive.api.auth.security.*;
import com.codearchive.api.auth.session.*;
import com.codearchive.api.auth.user.*;
import com.codearchive.api.solution.SolutionRepository;
import com.codearchive.api.common.exception.*;
import com.fasterxml.jackson.databind.ObjectMapper;

@SpringBootTest(properties = {"DB_PASSWORD=test-only", "codearchive.auth.dashboard-origin=https://codearchive-dashboard-beta.onrender.com",
        "codearchive.integrations.github.enabled=true", "codearchive.integrations.github.contents-read-enabled=true",
        "codearchive.integrations.github.contents-write-enabled=true"})
@AutoConfigureMockMvc @Testcontainers @ExtendWith(OutputCaptureExtension.class)
class GitHubUploadCommitIntegrationTest {
    private static final String BASE = "/api/v1/integrations/github/upload-intents";
    private static final String HEAD = "a".repeat(40), ROOT = "b".repeat(40), COMMIT = "c".repeat(40);
    private static final String CODE = "// synthetic-commit-source 한글\r\nclass Main {}\r\n";
    private static final GitHubUploadCommitService.Consent CONSENT = new GitHubUploadCommitService.Consent(true, true, true);
    @Container @ServiceConnection static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17-alpine");
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired UserRepository users;
    @Autowired AuthSessionRepository sessions;
    @Autowired SecureTokenCodec tokens;
    @Autowired SolutionRepository solutions;
    @Autowired JdbcTemplate db;
    @Autowired GitHubUploadCommitService service;
    @Autowired GitHubCommitExecutor executor;
    @Autowired GitHubAppProperties properties;
    @MockitoSpyBean GitHubUploadIntentStore intents;
    @MockitoBean GitHubAppClient github;
    GitHubAppClient.PreparedCommit prepared;
    record Actor(UUID id, UUID session, long githubId, String login, String token) {
        CodeArchivePrincipal principal() { return new CodeArchivePrincipal(id, session, login); }
    }
    @BeforeEach void enableMockOnlyGate() { properties.setContentsWriteEnabled(true); prepared = mock(GitHubAppClient.PreparedCommit.class); }
    @AfterEach void clean() { db.update("DELETE FROM users"); }

    @Test void exactReviewedSourceConsentAndReplayNeverMutateArchive(CapturedOutput output) throws Exception {
        var a = actor(); UUID source = capture(a); allow(a, true);
        var before = db.queryForMap("SELECT * FROM solutions WHERE id=?", source);
        String response = mvc.perform(post(BASE).header("Authorization", "Bearer " + a.token()).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(selection(source)))).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store, private"))
                .andExpect(jsonPath("$.data.preview.diff.after").value(CODE)).andReturn().getResponse().getContentAsString();
        UUID id = UUID.fromString(json.readTree(response).path("data").path("intentId").asText());
        String forged = "{\"confirmUpload\":true,\"acknowledgeVisibilityRisk\":true,\"code\":\"forged\",\"path\":\"other.java\",\"branch\":\"evil\"}";
        for (int i = 0; i < 2; i++) mvc.perform(post(BASE + "/{id}/commit", id).header("Authorization", "Bearer " + a.token())
                .contentType(MediaType.APPLICATION_JSON).content(forged)).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("SUCCEEDED"))
                .andExpect(jsonPath("$.data.commitSha").value(COMMIT)).andExpect(jsonPath("$.data.retryAllowed").value(false));
        verify(prepared, times(1)).create(CODE, "Add SWEA 1206 solution");
        assertThat(db.queryForMap("SELECT * FROM solutions WHERE id=?", source)).isEqualTo(before);
        assertThat(db.queryForObject("SELECT review::text FROM github_upload_intents WHERE id=?", String.class, id))
                .doesNotContain("synthetic-commit-source", a.token(), "forged");
        db.update("DELETE FROM solutions WHERE id=?", source);
        assertThat(service.status(a.principal(), id).status()).isEqualTo("SUCCEEDED");
        properties.setContentsWriteEnabled(false);
        assertThat(service.status(a.principal(), id).commitSha()).isEqualTo(COMMIT);
        assertThat(output).doesNotContain("synthetic-commit-source", a.token());
    }

    @Test void disabledWriteGateNeverCreatesIntentOrContactsProvider() throws Exception {
        var a = actor(); UUID source = capture(a); properties.setContentsWriteEnabled(false);
        assertThat(new GitHubAppProperties().isContentsWriteEnabled()).isFalse();
        error(() -> service.prepare(a.principal(), selection(source)), ErrorCode.GITHUB_INTEGRATION_UNAVAILABLE);
        assertThat(db.queryForObject("SELECT count(*) FROM github_upload_intents", Integer.class)).isZero();
        verifyNoInteractions(github, prepared);
    }

    @Test void temporaryCapacityLimitDoesNotConsumeReviewedManualIntent() throws Exception {
        var a=actor(); UUID source=capture(a); allow(a,true); UUID id=intent(a,source);
        assertThat(executor.reserve()).isTrue(); assertThat(executor.reserve()).isTrue();
        try {
            error(()->service.commit(a.principal(),id,CONSENT),ErrorCode.RATE_LIMITED);
            assertThat(state(id)).isEqualTo("READY");
            verifyNoInteractions(prepared);
        } finally { executor.release(); executor.release(); }
    }

    @Test void consentAndPrivatePublicDisclosureAreSeparateFromSyncAndCommunity() throws Exception {
        var a = actor(); UUID source = capture(a); allow(a, false); UUID id = intent(a, source);
        for (var consent : List.of(new GitHubUploadCommitService.Consent(false,true,true),
                new GitHubUploadCommitService.Consent(true,false,true), new GitHubUploadCommitService.Consent(true,true,false))) {
            error(() -> service.commit(a.principal(), id, consent), ErrorCode.GITHUB_UPLOAD_CONSENT_REQUIRED);
        }
        assertThat(state(id)).isEqualTo("READY"); verifyNoInteractions(prepared);
        assertThat(service.commit(a.principal(), id, CONSENT).status()).isEqualTo("SUCCEEDED");
        assertThat(db.queryForObject("SELECT community_public FROM solutions WHERE id=?", Boolean.class, source)).isFalse();
    }

    @Test void anotherAccountAnotherSessionExpiryAndLogoutCannotReuseConfirmation() throws Exception {
        var a = actor(); UUID source = capture(a); allow(a, true); UUID id = intent(a, source); var b = actor();
        error(() -> service.commit(b.principal(), id, CONSENT), ErrorCode.GITHUB_UPLOAD_INTENT_NOT_FOUND);
        var newSession = sessions.save(AuthSession.create(a.id(), tokens.hash(UUID.randomUUID().toString()), Instant.now().plusSeconds(3600), Instant.now()));
        error(() -> service.status(new CodeArchivePrincipal(a.id(), newSession.getId(), a.login()), id), ErrorCode.GITHUB_UPLOAD_INTENT_NOT_FOUND);
        db.update("UPDATE github_upload_intents SET expires_at=clock_timestamp()-interval '1 second' WHERE id=?", id);
        error(() -> service.commit(a.principal(), id, CONSENT), ErrorCode.GITHUB_UPLOAD_INTENT_EXPIRED);
        assertThat(service.status(a.principal(), id).status()).isEqualTo("EXPIRED");
        sessions.revoke(a.session(), Instant.now());
        error(() -> service.status(a.principal(), id), ErrorCode.AUTH_REQUIRED);
        verifyNoInteractions(prepared);
    }

    @ParameterizedTest @ValueSource(strings = {"edit", "metadata", "delete", "logout", "session-expiry", "permission", "privacy"})
    void changesAfterConfirmationFailBeforeSourceTransmission(String change) throws Exception {
        var a = actor(); UUID source = capture(a); allow(a, true); UUID id = intent(a, source);
        when(github.prepareCommit(any())).thenAnswer(call -> {
            switch (change) {
                case "edit" -> db.update("UPDATE solutions SET code='edited' WHERE id=?", source);
                case "metadata" -> db.update("UPDATE solutions SET title='Changed', updated_at=updated_at+interval '1 second' WHERE id=?", source);
                case "delete" -> db.update("DELETE FROM solutions WHERE id=?", source);
                case "logout" -> sessions.revoke(a.session(), Instant.now());
                case "session-expiry" -> db.update("UPDATE auth_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=?", a.session());
                case "permission" -> throw new CodeArchiveException(ErrorCode.ACCESS_DENIED);
                default -> throw new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_TARGET_CHANGED);
            }
            return prepared;
        });
        ErrorCode expected = switch (change) {
            case "logout", "session-expiry" -> ErrorCode.AUTH_REQUIRED;
            case "permission" -> ErrorCode.ACCESS_DENIED;
            case "privacy" -> ErrorCode.GITHUB_UPLOAD_TARGET_CHANGED;
            default -> ErrorCode.GITHUB_PREVIEW_SOURCE_CHANGED;
        };
        error(() -> service.commit(a.principal(), id, CONSENT), expected);
        assertThat(state(id)).isEqualTo("REJECTED"); verifyNoInteractions(prepared);
    }

    @Test void uncertainMutationCannotBeRetriedThroughSameOrNewIntent(CapturedOutput output) throws Exception {
        var a = actor(); UUID source = capture(a); allow(a, true); UUID id = intent(a, source);
        when(prepared.create(anyString(), anyString())).thenThrow(new IllegalStateException("provider-body-canary"));
        error(() -> service.commit(a.principal(), id, CONSENT), ErrorCode.GITHUB_UPLOAD_OUTCOME_UNKNOWN);
        assertThat(state(id)).isEqualTo("UNKNOWN");
        assertThat(service.commit(a.principal(), id, CONSENT).status()).isEqualTo("UNKNOWN");
        UUID newId = intent(a, source);
        error(() -> service.commit(a.principal(), newId, CONSENT), ErrorCode.GITHUB_UPLOAD_ALREADY_ATTEMPTED);
        // A new login, changed archive metadata/version and different message still cannot reset the target tombstone.
        var session = sessions.save(AuthSession.create(a.id(), tokens.hash(UUID.randomUUID().toString()), Instant.now().plusSeconds(3600), Instant.now()));
        var principal = new CodeArchivePrincipal(a.id(), session.getId(), a.login());
        db.update("UPDATE solutions SET title='New title', updated_at=updated_at+interval '1 second' WHERE id=?", source);
        var selected = selection(source);
        var changed = new GitHubUploadPreviewService.Request(source, selected.expectedUpdatedAt(), 701, 801, "main", HEAD, null, "Different message");
        UUID changedId = service.prepare(principal, changed).intentId();
        error(() -> service.commit(principal, changedId, CONSENT), ErrorCode.GITHUB_UPLOAD_ALREADY_ATTEMPTED);
        verify(prepared, times(1)).create(anyString(), anyString());
        assertThat(output).doesNotContain("provider-body-canary", "synthetic-commit-source");
    }

    @Test void persistedPriorProcessAttemptIsNeverReclaimed() throws Exception {
        var a = actor(); UUID source = capture(a); allow(a, true); UUID id = intent(a, source);
        // Simulate a process stopping after the durable claim, before recording a result.
        assertThat(intents.claim(a.principal(), id).acquired()).isTrue();
        assertThat(service.commit(a.principal(), id, CONSENT).status()).isEqualTo("UNKNOWN");
        UUID other = intent(a, source);
        error(() -> service.commit(a.principal(), other, CONSENT), ErrorCode.GITHUB_UPLOAD_ALREADY_ATTEMPTED);
        verifyNoInteractions(prepared);
    }

    @Test void successfulRemoteMutationWithLostDatabaseReceiptRemainsNonRetryable() throws Exception {
        var a = actor(); UUID source = capture(a); allow(a, true); UUID id = intent(a, source);
        doThrow(new DataAccessResourceFailureException("synthetic-db-failure")).when(intents).finish(eq(id), eq("SUCCEEDED"), any(), isNull());
        error(() -> service.commit(a.principal(), id, CONSENT), ErrorCode.GITHUB_UPLOAD_OUTCOME_UNKNOWN);
        assertThat(service.commit(a.principal(), id, CONSENT).status()).isEqualTo("UNKNOWN");
        verify(prepared, times(1)).create(anyString(), anyString());
    }

    @Test void concurrentDifferentIntentIdsForSameTargetDispatchOnlyOnce() throws Exception {
        var a = actor(); UUID source = capture(a); allow(a, true); UUID first = intent(a, source), second = intent(a, source);
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
        when(prepared.create(anyString(), anyString())).thenAnswer(call -> {
            entered.countDown(); if (!release.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("test timeout"); return committed(a);
        });
        try (var pool = Executors.newFixedThreadPool(2)) {
            var run = pool.submit(() -> service.commit(a.principal(), first, CONSENT));
            try {
                assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
                error(() -> service.commit(a.principal(), second, CONSENT), ErrorCode.GITHUB_UPLOAD_ALREADY_ATTEMPTED);
                assertThat(service.commit(a.principal(), first, CONSENT).status()).isEqualTo("UNKNOWN");
            } finally { release.countDown(); }
            assertThat(run.get(5, TimeUnit.SECONDS).status()).isEqualTo("SUCCEEDED");
        }
        verify(prepared, times(1)).create(anyString(), anyString());
    }

    @ParameterizedTest @ValueSource(strings = {"edit", "logout"})
    void finalSourceAndSessionLocksSerializeCompetingChangesWithDispatch(String change) throws Exception {
        var a = actor(); UUID source = capture(a); allow(a, true); UUID id = intent(a, source);
        var pending = new AtomicReference<Future<?>>();
        try (var pool = Executors.newSingleThreadExecutor()) {
            when(prepared.create(anyString(), anyString())).thenAnswer(call -> {
                pending.set(pool.submit(() -> {
                    var writer = new JdbcTemplate(Objects.requireNonNull(db.getDataSource())); writer.setQueryTimeout(3);
                    if (change.equals("edit")) writer.update("UPDATE solutions SET code='edit after dispatch' WHERE id=?", source);
                    else writer.update("UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE id=?", a.session());
                }));
                assertThatThrownBy(() -> pending.get().get(150, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
                return committed(a);
            });
            assertThat(service.commit(a.principal(), id, CONSENT).status()).isEqualTo("SUCCEEDED");
            pending.get().get(5, TimeUnit.SECONDS);
        }
        if (change.equals("edit")) assertThat(db.queryForObject("SELECT accepted_capture FROM solutions WHERE id=?", Boolean.class, source)).isFalse();
        else error(() -> service.status(a.principal(), id), ErrorCode.AUTH_REQUIRED);
    }

    @Test void cookieCommitRequiresExactOriginAndCannotMixCredentials() throws Exception {
        var a = actor(); UUID source = capture(a); allow(a, true); UUID id = intent(a, source);
        var cookie = new MockCookie(ApiAuthenticationFilter.SESSION_COOKIE_NAME, a.token());
        String body = json.writeValueAsString(CONSENT);
        mvc.perform(post(BASE + "/{id}/commit", id).contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isUnauthorized());
        mvc.perform(post(BASE + "/{id}/commit", id).cookie(cookie).contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isForbidden());
        mvc.perform(post(BASE + "/{id}/commit", id).cookie(cookie).header("Origin", "https://untrusted.test")
                .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isForbidden());
        mvc.perform(post(BASE + "/{id}/commit", id).cookie(cookie).header("Authorization", "Bearer " + a.token())
                .header("Origin", "https://codearchive-dashboard-beta.onrender.com").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(prepared);
        mvc.perform(post(BASE + "/{id}/commit", id).cookie(cookie).header("Origin", "https://codearchive-dashboard-beta.onrender.com")
                .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isOk());
    }

    private Actor actor() {
        Instant now = Instant.now(); long githubId = UUID.randomUUID().getMostSignificantBits() & Long.MAX_VALUE;
        String login = "u" + githubId;
        var user = users.save(CodeArchiveUser.create(new GitHubUserProfile(githubId, login, "Synthetic", null), now));
        String token = UUID.randomUUID().toString();
        var session = sessions.save(AuthSession.create(user.getId(), tokens.hash(token), now.plusSeconds(3600), now));
        return new Actor(user.getId(), session.getId(), githubId, login, token);
    }
    private UUID capture(Actor a) throws Exception {
        String client = UUID.randomUUID().toString(); var p = new HashMap<String, Object>();
        p.put("clientRecordId", client); p.put("platform", "SWEA"); p.put("problemNumber", "1206");
        p.put("title", "Synthetic"); p.put("language", "Java"); p.put("code", CODE); p.put("result", "ACCEPTED");
        p.put("solvedAt", "2026-08-30T01:00:00Z"); p.put("observedAt", "2026-08-30T01:00:01Z"); p.put("aiUsage", "unknown");
        mvc.perform(post("/api/v1/solutions/bulk-upsert").header("Authorization", "Bearer " + a.token()).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("records", List.of(p))))).andExpect(status().isOk());
        return solutions.findByUserIdAndClientRecordId(a.id(), client).orElseThrow().getId();
    }
    private GitHubUploadPreviewService.Request selection(UUID source) {
        return new GitHubUploadPreviewService.Request(source, db.queryForObject("SELECT updated_at FROM solutions WHERE id=?", java.sql.Timestamp.class, source).toInstant(),
                701, 801, "main", HEAD, null, null);
    }
    private UUID intent(Actor a, UUID source) { return service.prepare(a.principal(), selection(source)).intentId(); }
    private String state(UUID id) { return db.queryForObject("SELECT status FROM github_upload_intents WHERE id=?", String.class, id); }
    private GitHubAppClient.CommitResult committed(Actor a) { return new GitHubAppClient.CommitResult(COMMIT, "https://github.com/" + a.login() + "/solutions/commit/" + COMMIT); }
    private void allow(Actor a, boolean privateRepo) {
        var owner = new GitHubAppClient.Account(a.githubId(), a.login(), "User");
        when(github.findPersonalInstallation(a.login())).thenReturn(Optional.of(new GitHubAppClient.Installation(701, owner, "selected", false)));
        when(github.inspectUploadTarget(anyLong(), anyLong(), anyLong(), anyString(), anyString(), anyString()))
                .thenReturn(new GitHubAppClient.UploadTarget(new GitHubAppClient.Repository(801, owner, "solutions", privateRepo, "main"), "main", HEAD, ROOT, false, List.of(), null, null));
        when(github.prepareCommit(any())).thenReturn(prepared);
        when(prepared.create(anyString(), anyString())).thenReturn(committed(a));
    }
    private void error(Runnable action, ErrorCode expected) {
        assertThatThrownBy(action::run).isInstanceOf(CodeArchiveException.class).satisfies(failure -> {
            assertThat(((CodeArchiveException) failure).getErrorCode()).isEqualTo(expected);
            assertThat(failure.getCause()).isNull();
            assertThat(failure.getMessage()).doesNotContain("canary", "synthetic-commit-source");
        });
    }
}
