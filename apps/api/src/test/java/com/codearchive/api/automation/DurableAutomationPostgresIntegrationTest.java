package com.codearchive.api.automation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.codearchive.api.integration.github.GitHubAppClient;
import com.codearchive.api.integration.github.GitHubIntegrationService;
import com.codearchive.api.integration.github.GitHubAutoCommitStore.Target;
import com.codearchive.api.relay.RelayCaptureIngestService;
import com.codearchive.api.relay.RelayGrantPrincipal;
import com.codearchive.api.relay.RelayGrantService;
import com.codearchive.api.auth.session.AuthSessionReplacementService;
import com.fasterxml.jackson.databind.ObjectMapper;

@SpringBootTest(properties = {
        "DB_PASSWORD=test-only",
        "codearchive.auth.dashboard-origin=https://codearchive-dashboard-beta.onrender.com",
        "codearchive.integrations.github.enabled=true",
        "codearchive.integrations.github.contents-read-enabled=true",
        "codearchive.integrations.github.contents-write-enabled=true"
})
@Testcontainers
class DurableAutomationPostgresIntegrationTest {

    private static final String HEAD = "a".repeat(40);
    private static final String COMMIT = "c".repeat(40);
    private static final Target TARGET = new Target(701, 801, "main", HEAD,
            "archive", true, "tester/solutions");

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17-alpine");

    @Autowired
    private JdbcTemplate db;

    @Autowired
    private ObjectMapper json;

    @Autowired
    private DurableAutomationWorker worker;

    @Autowired
    private DurableAutomationProfileStore profiles;

    @Autowired
    private AuthSessionReplacementService sessionReplacement;

    @Autowired
    private RelayCaptureIngestService relay;

    @MockitoBean
    private GitHubIntegrationService integrations;

    @MockitoBean
    private GitHubAppClient github;

    @MockitoBean
    private RelayGrantService grants;

    private GitHubAppClient.PreparedCommit prepared;

    @BeforeEach
    void setUpProvider() {
        prepared = org.mockito.Mockito.mock(GitHubAppClient.PreparedCommit.class);
        when(integrations.requireInstallationForUser(any(UUID.class), eq(701L)))
                .thenReturn(installation());
        when(github.inspectUploadTarget(anyLong(), anyLong(), anyLong(), anyString(), anyString(), anyString()))
                .thenReturn(uploadTarget());
        when(github.prepareCommit(any())).thenReturn(prepared);
        when(prepared.create(anyString(), anyString()))
                .thenReturn(new GitHubAppClient.CommitResult(COMMIT,
                        "https://github.com/tester/solutions/commit/" + COMMIT));
    }

    @AfterEach
    void cleanDatabase() {
        db.update("DELETE FROM users");
    }

    @Test
    void durableWorkerCommitsAttemptFenceBeforeProviderCreateWithoutSelfLock() {
        UUID user = user();
        UUID solution = acceptedSolution(user, 3, Instant.now().minusSeconds(1));
        profile(user, 3, 4, TARGET, true, "DURABLE_SERVER");

        DurableAutomationWorker.Result result = worker.runOnce();

        assertThat(result.status()).isEqualTo("SUCCEEDED");
        assertThat(db.queryForObject(
                "SELECT state FROM durable_github_attempts WHERE user_id=? AND solution_id=?",
                String.class, user, solution)).isEqualTo("SUCCEEDED");
        assertThat(db.queryForObject(
                "SELECT target->>'expectedCommitSha' FROM automation_profiles WHERE user_id=?",
                String.class, user)).isEqualTo(COMMIT);
        verify(prepared).create("class Main {}", "Add SWEA 1206 solution");
    }

    @Test
    void expiredBoundAuthSessionBlocksDurableWorkerClaim() {
        UUID user = user();
        acceptedSolution(user, 3, Instant.now().minusSeconds(1));
        profile(user, 3, 4, TARGET, true, "DURABLE_SERVER");
        db.update("UPDATE auth_sessions SET expires_at=? WHERE id=(SELECT auth_session_id FROM automation_profiles WHERE user_id=?)",
                Timestamp.from(Instant.now().minusSeconds(1)), user);

        assertThat(worker.runOnce().status()).isEqualTo("IDLE");
        verify(github, never()).prepareCommit(any());
    }

    @Test
    void accountReplacementFencesPriorAndNewAccountBeforeIssuingSession() {
        UUID accountA = user();
        UUID accountB = user();
        profile(accountA, 3, 4, TARGET, true, "DURABLE_SERVER");
        profile(accountB, 5, 6, TARGET, true, "DURABLE_SERVER");
        UUID oldSession = db.queryForObject("SELECT auth_session_id FROM automation_profiles WHERE user_id=?",
                UUID.class, accountA);
        Instant now = Instant.now();

        AuthSessionReplacementService.Issued issued = sessionReplacement.replace(accountA, oldSession, accountB,
                UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", ""),
                now.plusSeconds(3600), now);

        assertThat(db.queryForObject("SELECT revoked_at IS NOT NULL FROM auth_sessions WHERE id=?", Boolean.class, oldSession))
                .isTrue();
        assertThat(db.queryForObject("SELECT source_transfer_enabled FROM automation_profiles WHERE user_id=?", Boolean.class, accountA))
                .isFalse();
        assertThat(db.queryForObject("SELECT source_transfer_enabled FROM automation_profiles WHERE user_id=?", Boolean.class, accountB))
                .isFalse();
        assertThat(db.queryForObject("SELECT count(*) FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL", Integer.class, accountB))
                .isEqualTo(1);
        assertThat(db.queryForObject("SELECT revoked_at FROM auth_sessions WHERE id=?", Timestamp.class, issued.sessionId()))
                .isNull();
    }

    @Test
    void concurrentSameAccountReplacementLeavesOnlyLastSessionActive() throws Exception {
        UUID account = user();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            var first = pool.submit(() -> sessionReplacement.replace(null, null, account,
                    UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", ""),
                    Instant.now().plusSeconds(3600), Instant.now()));
            var second = pool.submit(() -> sessionReplacement.replace(null, null, account,
                    UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", ""),
                    Instant.now().plusSeconds(3600), Instant.now()));
            first.get(15, TimeUnit.SECONDS);
            second.get(15, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        assertThat(db.queryForObject("SELECT count(*) FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL", Integer.class, account))
                .isEqualTo(1);
    }

    @Test
    void relayDuplicateWithHistoricalNullProvenanceIsExistingButNotDurableEligible() {
        UUID user = user();
        Instant observed = Instant.now().minusSeconds(1).truncatedTo(ChronoUnit.MICROS);
        profile(user, 9, 1, TARGET, true, "DURABLE_SERVER");
        UUID solution = UUID.randomUUID();
        db.update("""
                INSERT INTO solutions(id,user_id,client_record_id,platform,problem_number,title,language,code,result,
                    solved_at,observed_at,execution_time,memory_usage,ai_usage,accepted_capture,community_public,
                    published_at,capture_generation,captured_at,created_at,updated_at)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, FALSE, NULL, NULL, NULL, ?, ?)
                """, solution, user, "client-historical", "SWEA", "1206", "title", "Java", "class Main {}",
                "ACCEPTED", Timestamp.from(observed), Timestamp.from(observed), "78 ms", "25,472 kb", "unknown",
                Timestamp.from(observed), Timestamp.from(observed));

        RelayGrantPrincipal principal = new RelayGrantPrincipal(user, UUID.randomUUID(), "device-1234567890", 9);
        RelayCaptureIngestService.Item item = new RelayCaptureIngestService.Item(
                "client-historical", "SWEA", "1206", "title", "Java", "class Main {}", "ACCEPTED",
                observed, observed, observed, "78 ms", "25,472 kb", "unknown");

        RelayCaptureIngestService.Response response = relay.ingest(principal,
                new RelayCaptureIngestService.Request(List.of(item)));

        assertThat(response.results()).singleElement().satisfies(result -> {
            assertThat(result.outcome()).isEqualTo("EXISTING");
            assertThat(result.ackEligible()).isTrue();
        });
        assertThat(worker.runOnce().status()).isEqualTo("IDLE");
        verify(github, never()).prepareCommit(any());

        RelayCaptureIngestService.Item changed = new RelayCaptureIngestService.Item(
                "client-historical", "SWEA", "1206", "title", "Java", "different", "ACCEPTED",
                observed, observed, observed, "78 ms", "25,472 kb", "unknown");
        assertThat(relay.ingest(principal, new RelayCaptureIngestService.Request(List.of(changed)))
                .results()).singleElement().satisfies(result -> {
                    assertThat(result.outcome()).isEqualTo("CONFLICT");
                    assertThat(result.ackEligible()).isFalse();
                });
        assertThat(db.queryForObject("SELECT capture_generation FROM solutions WHERE id=?", Object.class, solution))
                .isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"CLAIMED", "ATTEMPTED", "UNKNOWN"})
    void unresolvedDurableAttemptBlocksReturnToPageOwned(String state) {
        UUID user = user();
        profile(user, 3, 4, TARGET, true, "DURABLE_SERVER");
        attempt(user, UUID.randomUUID(), 3, 4, state);

        assertThatThrownBy(() -> updateProfile(user, false, "PAGE_OWNED", 3, TARGET, 0))
                .isInstanceOfSatisfying(CodeArchiveException.class,
                        error -> assertThat(error.getErrorCode())
                                .isEqualTo(ErrorCode.AUTOMATION_OWNERSHIP_CONFLICT));
    }

    @Test
    void terminalDurableAttemptAllowsSafeReturnToPageOwned() {
        UUID user = user();
        profile(user, 3, 4, TARGET, true, "DURABLE_SERVER");
        UUID attempt = attempt(user, UUID.randomUUID(), 3, 4, "SUCCEEDED");
        db.update("UPDATE durable_github_attempts SET commit_sha=?,commit_url=? WHERE id=?",
                COMMIT, "https://github.com/tester/solutions/commit/" + COMMIT, attempt);

        updateProfile(user, false, "PAGE_OWNED", 3, TARGET, 0);

        assertThat(db.queryForObject("SELECT ownership_mode FROM automation_profiles WHERE user_id=?",
                String.class, user)).isEqualTo("PAGE_OWNED");
    }

    @Test
    void pageOwnedTransitionRacesProviderDispatchWithoutAllowingStaleWrite() throws Exception {
        UUID user = user();
        acceptedSolution(user, 3, Instant.now().minusSeconds(1));
        profile(user, 3, 4, TARGET, true, "DURABLE_SERVER");
        CountDownLatch providerEntered = new CountDownLatch(1);
        CountDownLatch releaseProvider = new CountDownLatch(1);
        when(prepared.create(anyString(), anyString())).thenAnswer(invocation -> {
            providerEntered.countDown();
            assertThat(releaseProvider.await(10, TimeUnit.SECONDS)).isTrue();
            return new GitHubAppClient.CommitResult(COMMIT,
                    "https://github.com/tester/solutions/commit/" + COMMIT);
        });

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            var workerResult = pool.submit(worker::runOnce);
            assertThat(providerEntered.await(10, TimeUnit.SECONDS)).isTrue();
            var transition = pool.submit(() -> updateProfile(user, false, "PAGE_OWNED", 3, TARGET, 0));
            releaseProvider.countDown();

            var completed = workerResult.get(10, TimeUnit.SECONDS);
            assertThat(completed.status()).withFailMessage("worker error=%s", completed.errorCode()).isEqualTo("SUCCEEDED");
            transition.get(10, TimeUnit.SECONDS);
            assertThat(db.queryForObject("SELECT ownership_mode FROM automation_profiles WHERE user_id=?",
                    String.class, user)).isEqualTo("PAGE_OWNED");
            assertThat(db.queryForObject("SELECT state FROM durable_github_attempts WHERE user_id=?",
                    String.class, user)).isEqualTo("SUCCEEDED");
        } finally {
            releaseProvider.countDown();
            pool.shutdownNow();
        }
    }

    @Test
    void authSessionExpiryDuringProviderPreparationBlocksCreate() throws Exception {
        UUID user = user();
        acceptedSolution(user, 3, Instant.now().minusSeconds(1));
        profile(user, 3, 4, TARGET, true, "DURABLE_SERVER");
        CountDownLatch preparationEntered = new CountDownLatch(1);
        CountDownLatch releasePreparation = new CountDownLatch(1);
        org.mockito.Mockito.doAnswer(invocation -> {
            preparationEntered.countDown();
            assertThat(releasePreparation.await(10, TimeUnit.SECONDS)).isTrue();
            return prepared;
        }).when(github).prepareCommit(any());

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            var workerResult = pool.submit(worker::runOnce);
            assertThat(preparationEntered.await(10, TimeUnit.SECONDS)).isTrue();
            db.update("UPDATE auth_sessions SET expires_at=? WHERE id=(SELECT auth_session_id FROM automation_profiles WHERE user_id=?)",
                    Timestamp.from(Instant.now().minusSeconds(1)), user);
            releasePreparation.countDown();

            DurableAutomationWorker.Result completed = workerResult.get(10, TimeUnit.SECONDS);
            assertThat(completed.status()).isEqualTo("REJECTED");
            verify(prepared, never()).create(anyString(), anyString());
            assertThat(db.queryForObject("SELECT state FROM durable_github_attempts WHERE user_id=?",
                    String.class, user)).isEqualTo("REJECTED");
        } finally {
            releasePreparation.countDown();
            pool.shutdownNow();
        }
    }

    @Test
    void unknownOutcomeCannotBeBypassedByGenerationOrTargetChangeBeforeReenable() {
        UUID user = user();
        profile(user, 3, 4, TARGET, false, "DURABLE_SERVER");
        attempt(user, UUID.randomUUID(), 3, 4, "UNKNOWN");
        Target changedTarget = TARGET.withHead("b".repeat(40));

        updateProfile(user, false, "DURABLE_SERVER", 4, changedTarget, 0);

        assertThatThrownBy(() -> updateProfile(user, true, "DURABLE_SERVER", 4, changedTarget, 1))
                .isInstanceOfSatisfying(CodeArchiveException.class,
                        error -> assertThat(error.getErrorCode())
                                .isEqualTo(ErrorCode.GITHUB_UPLOAD_OUTCOME_UNKNOWN));
        assertThat(db.queryForObject("SELECT github_auto_commit_enabled FROM automation_profiles WHERE user_id=?",
                Boolean.class, user)).isFalse();
    }

    private UUID user() {
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();
        db.update("INSERT INTO users(id,github_user_id,github_login,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                id, Math.abs(UUID.randomUUID().getMostSignificantBits()), "tester-" + id, "Tester",
                Timestamp.from(now), Timestamp.from(now));
        return id;
    }

    private void profile(UUID user, long generation, long targetGeneration, Target target,
            boolean githubEnabled, String mode) {
        Instant enabled = Instant.now().minusSeconds(2);
        UUID session = UUID.randomUUID();
        db.update("INSERT INTO auth_sessions(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)",
                session, user, UUID.randomUUID().toString().replace("-", "")
                        + UUID.randomUUID().toString().replace("-", ""),
                Timestamp.from(Instant.now().plusSeconds(3600)), Timestamp.from(enabled));
        db.update("""
                INSERT INTO automation_profiles(user_id,device_id,generation,source_transfer_enabled,
                    github_auto_commit_enabled,ownership_mode,target_generation,target,automatic_transfer_consent,
                    visibility_risk_consent,public_upload_consent,github_enabled_at,version,updated_at,auth_session_id)
                VALUES(?,?,?,?,?,?,?,CAST(? AS jsonb),TRUE,TRUE,TRUE,?,?,?,?)
                """, user, "device-1234567890", generation, true, githubEnabled, mode, targetGeneration,
                target == null ? null : jsonValue(target), Timestamp.from(enabled), 0, Timestamp.from(enabled), session);
    }

    private UUID attempt(UUID user, UUID solution, long generation, long targetGeneration, String state) {
        UUID id = UUID.randomUUID();
        String sha = "SUCCEEDED".equals(state) ? COMMIT : null;
        String url = "SUCCEEDED".equals(state) ? "https://github.com/tester/solutions/commit/" + COMMIT : null;
        db.update("""
                INSERT INTO durable_github_attempts(id,user_id,solution_id,profile_generation,target_generation,
                    state,claim_token,lease_until,commit_sha,commit_url)
                VALUES(?,?,?,?,?,?,?,clock_timestamp()+interval '60 seconds',?,?)
                """, id, user, solution, generation, targetGeneration, state,
                UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", ""), sha, url);
        return id;
    }

    private UUID acceptedSolution(UUID user, long generation, Instant capturedAt) {
        UUID id = UUID.randomUUID();
        db.update("""
                INSERT INTO solutions(id,user_id,client_record_id,platform,problem_number,title,language,code,result,
                    solved_at,observed_at,execution_time,memory_usage,ai_usage,accepted_capture,community_public,
                    published_at,capture_generation,captured_at,created_at,updated_at)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, FALSE, NULL, ?, ?, ?, ?)
                """, id, user, "client-" + id, "SWEA", "1206", "title", "Java", "class Main {}", "ACCEPTED",
                Timestamp.from(capturedAt), Timestamp.from(capturedAt), "78 ms", "25,472 kb", "unknown", generation,
                Timestamp.from(capturedAt), Timestamp.from(capturedAt), Timestamp.from(capturedAt));
        return id;
    }

    private DurableAutomationProfileStore.Profile updateProfile(UUID user, boolean githubEnabled, String mode,
            long generation, Target target, long expectedVersion) {
        UUID session = db.queryForObject("SELECT auth_session_id FROM automation_profiles WHERE user_id=?",
                UUID.class, user);
        return profiles.update(user, session, "device-1234567890", true, githubEnabled, mode,
                target == null ? 0 : 4, target, true, true, true, expectedVersion,
                githubEnabled ? Instant.now() : null, generation, Instant.now());
    }

    private GitHubAppClient.Installation installation() {
        return new GitHubAppClient.Installation(701,
                new GitHubAppClient.Account(9001, "tester", "User"), "selected", false);
    }

    private GitHubAppClient.UploadTarget uploadTarget() {
        GitHubAppClient.Account owner = new GitHubAppClient.Account(9001, "tester", "User");
        GitHubAppClient.Repository repository = new GitHubAppClient.Repository(801, owner, "solutions", true, "main");
        return new GitHubAppClient.UploadTarget(repository, "main", HEAD, "b".repeat(40), false,
                List.of(), null, null);
    }

    private String jsonValue(Target target) {
        try {
            return json.writeValueAsString(target);
        } catch (Exception exception) {
            throw new AssertionError(exception);
        }
    }
}
