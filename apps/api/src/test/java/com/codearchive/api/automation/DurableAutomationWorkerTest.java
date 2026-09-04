package com.codearchive.api.automation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.junit.jupiter.api.extension.ExtendWith;

import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.codearchive.api.integration.github.GitHubAppClient;
import com.codearchive.api.integration.github.GitHubAutoCommitStore;
import com.codearchive.api.integration.github.GitHubCommitExecutor;
import com.codearchive.api.integration.github.GitHubIntegrationService;
import com.codearchive.api.integration.github.GitHubPreviewSolutionReader;
import com.codearchive.api.integration.github.GitHubUploadIntentStore;

@ExtendWith(MockitoExtension.class)
class DurableAutomationWorkerTest {

    private static final Instant NOW = Instant.parse("2026-09-04T00:00:00Z");
    private static final String HEAD = "a".repeat(40);
    private static final GitHubAutoCommitStore.Target TARGET = new GitHubAutoCommitStore.Target(
            701, 801, "main", HEAD, "archive", true, "tester/solutions");

    @Mock DurableWorkerStore store;
    @Mock GitHubIntegrationService integrations;
    @Mock GitHubAppClient github;
    @Mock GitHubCommitExecutor executor;
    @Mock GitHubPreviewSolutionReader sources;
    @Mock GitHubAppClient.PreparedCommit prepared;
    private DurableAutomationWorker worker;
    private DurableWorkerStore.Claim claim;
    private UUID userId;
    private UUID solutionId;

    @BeforeEach
    void setUp() {
        worker = new DurableAutomationWorker(store, integrations, github, executor, sources,
                java.time.Clock.fixed(NOW, java.time.ZoneOffset.UTC));
        userId = UUID.randomUUID();
        solutionId = UUID.randomUUID();
        claim = new DurableWorkerStore.Claim(UUID.randomUUID(), userId, solutionId, 3, 4, TARGET,
                NOW.minusSeconds(30), NOW.plusSeconds(60), "c".repeat(64));
        when(store.claimNext()).thenReturn(Optional.of(claim));
        when(sources.find(userId, solutionId)).thenReturn(Optional.of(new GitHubPreviewSolutionReader.Snapshot(
                solutionId, "SWEA", "1206", "Java", "class Main {}", "ACCEPTED", true, NOW)));
        when(integrations.requireInstallationForUser(userId, 701)).thenReturn(new GitHubAppClient.Installation(
                701, new GitHubAppClient.Account(9001, "tester", "User"), "selected", false));
        lenient().when(github.inspectUploadTarget(eq(701L), eq(801L), eq(9001L), eq("main"), eq(HEAD), anyString()))
                .thenReturn(new GitHubAppClient.UploadTarget(
                        new GitHubAppClient.Repository(801, new GitHubAppClient.Account(9001, "tester", "User"),
                                "solutions", true, "main"), "main", HEAD, "b".repeat(40), false, java.util.List.of(), null, null));
        lenient().when(executor.executeForWorker(eq(userId), any(GitHubUploadIntentStore.Review.class),
                eq(claim.leaseUntil()), any(Runnable.class), any(Runnable.class)))
                .thenReturn(new GitHubAppClient.CommitResult("d".repeat(40), "https://github.com/tester/solutions/commit/" + "d".repeat(40)));
    }

    @Test
    void claimsFreshAcceptedCaptureAndFinishesSuccessfulCreateOnlyAttempt() {
        DurableAutomationWorker.Result result = worker.runOnce();

        assertThat(result.status()).isEqualTo("SUCCEEDED");
        verify(store).requireLive(claim);
        verify(store).finish(eq(claim), any(GitHubAppClient.CommitResult.class), isNull(), eq(true));
        verify(executor).executeForWorker(eq(userId), any(GitHubUploadIntentStore.Review.class),
                eq(claim.leaseUntil()), any(Runnable.class), any(Runnable.class));
    }

    @Test
    void providerUncertaintyIsTerminalAndNeverRetried() {
        when(executor.executeForWorker(eq(userId), any(GitHubUploadIntentStore.Review.class),
                eq(claim.leaseUntil()), any(Runnable.class), any(Runnable.class)))
                .thenAnswer(invocation -> {
                    invocation.<Runnable>getArgument(4).run();
                    throw new IllegalStateException("provider timeout");
                });
        DurableAutomationWorker.Result result = worker.runOnce();

        assertThat(result.status()).isEqualTo("UNKNOWN");
        verify(store).finish(eq(claim), isNull(), eq(ErrorCode.INTERNAL_ERROR), eq(true));
        verify(store, never()).finish(eq(claim), any(GitHubAppClient.CommitResult.class), isNull(), eq(true));
    }

    @Test
    void nullProviderResultIsAlsoUnknownAndNeverReportedAsSuccess() {
        when(executor.executeForWorker(eq(userId), any(GitHubUploadIntentStore.Review.class),
                eq(claim.leaseUntil()), any(Runnable.class), any(Runnable.class))).thenReturn(null);

        DurableAutomationWorker.Result result = worker.runOnce();

        assertThat(result.status()).isEqualTo("UNKNOWN");
        verify(store).finish(eq(claim), isNull(), eq(ErrorCode.GITHUB_UPLOAD_OUTCOME_UNKNOWN), eq(true));
    }

    @Test
    void preDispatchValidationFailureIsRejectedWithoutProviderDispatch() {
        doThrow(new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_TARGET_CHANGED))
                .when(github).inspectUploadTarget(anyLong(), anyLong(), anyLong(), anyString(), anyString(), anyString());

        DurableAutomationWorker.Result result = worker.runOnce();

        assertThat(result.status()).isEqualTo("REJECTED");
        verify(store).finish(eq(claim), isNull(), eq(ErrorCode.GITHUB_UPLOAD_TARGET_CHANGED), eq(false));
        verify(executor, never()).executeForWorker(any(), any(), any(), any(), any());
    }
}
