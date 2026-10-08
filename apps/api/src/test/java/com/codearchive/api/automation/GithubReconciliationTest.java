package com.codearchive.api.automation;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.codearchive.api.auth.AppUser;
import com.codearchive.api.settings.*;
import com.codearchive.api.solution.*;
import java.lang.reflect.Field;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class GithubReconciliationTest {
    private final GithubCommitJobRepository jobs = mock(GithubCommitJobRepository.class);
    private final UserSettingsRepository settings = mock(UserSettingsRepository.class);
    private final GithubProvider provider = mock(GithubProvider.class);
    private final GithubAutomationService service = new GithubAutomationService(jobs, settings, mock(SolutionRepository.class), provider);
    private final AppUser user = AppUser.fromGithub("1", "owner", "Owner", null);
    private final Solution solution = new Solution(user, "capture", Platform.SWEA, "1", "Title", "https://example.test", "Java", "class X{}", "ACCEPTED", Instant.EPOCH, Instant.EPOCH, null, null);
    private final GithubCommitJob job = new GithubCommitJob(user, "capture", 7, CommitJobOrigin.HISTORICAL_MANUAL);
    private final UserSettings current = new UserSettings(user);

    private void setup(GithubProvider.Diagnostic diagnostic) throws Exception {
        field(user, "id", 1L); field(job, "id", 2L);
        current.apply(new SettingsRequest(0, "n", "n", false, false, false, "{number}", "{number}", "Add solution", "github-light", "github-dark", true, false, 44L, "owner", "repo", "main", null));
        field(current, "version", 7L); solution.setHistoricalImport(true); solution.setHistoricalSubmissionId("123");
        job.start(); job.terminal(CommitJobState.UNKNOWN); job.recordContext("a".repeat(64)); job.recordDiagnostic(diagnostic);
        when(jobs.findByUserIdAndCaptureId(1L, "capture")).thenReturn(Optional.of(job));
        when(jobs.findByIdForClaim(2L)).thenReturn(Optional.of(job));
        when(settings.findByUserId(1L)).thenReturn(Optional.of(current));
        when(provider.recoveryContext(current, solution)).thenReturn("a".repeat(64));
    }
    @Test void exactMatchRecoversWithoutCreatingAnotherCommit() throws Exception {
        setup(GithubProvider.Diagnostic.REF_UNCONFIRMED); when(provider.compare(current, solution)).thenReturn(GithubProvider.Comparison.MATCH);
        assertThat(service.reconcile(solution, 7, false).state()).isEqualTo("SUCCEEDED");
        verify(provider, never()).createOnly(any(), any(), any());
    }
    @Test void missingFileDoesNotMakeAnUncertainRefSafeToRetry() throws Exception {
        setup(GithubProvider.Diagnostic.REF_UNCONFIRMED); when(provider.compare(current, solution)).thenReturn(GithubProvider.Comparison.MISSING);
        assertThat(service.reconcile(solution, 7, false).retryAllowed()).isFalse();
        assertThatThrownBy(() -> service.reconcile(solution, 7, true)).isInstanceOf(CaptureValidationException.class);
        assertThat(job.getState()).isEqualTo(CommitJobState.UNKNOWN);
    }
    @Test void explicitRetryRequiresASecondComparisonAndKnownPreRefFailure() throws Exception {
        setup(GithubProvider.Diagnostic.BLOB_UNCONFIRMED); when(provider.compare(current, solution)).thenReturn(GithubProvider.Comparison.MISSING);
        assertThat(service.reconcile(solution, 7, false).retryAllowed()).isTrue();
        assertThat(service.reconcile(solution, 7, true).state()).isEqualTo("PENDING");
        assertThat(job.getDeliveryGeneration()).isEqualTo(1); verify(provider, times(2)).compare(current, solution);
    }
    @Test void legacyContextAndChangedSettingsNeverReadOrRetryGuessedTargets() throws Exception {
        setup(GithubProvider.Diagnostic.LEASE_EXPIRED); job.recordContext(null);
        assertThat(service.reconcile(solution, 7, true).comparison()).isEqualTo("CONTEXT_UNAVAILABLE");
        job.recordContext("a".repeat(64));
        assertThat(service.reconcile(solution, 8, false).comparison()).isEqualTo("CONTEXT_UNAVAILABLE");
        verify(provider, never()).compare(any(), any()); assertThat(job.getState()).isEqualTo(CommitJobState.UNKNOWN);
    }
    @Test void settingsChangedDuringNetworkReadDiscardTheResult() throws Exception {
        setup(GithubProvider.Diagnostic.REF_UNCONFIRMED);
        when(provider.compare(current, solution)).thenAnswer(invocation -> { field(current, "version", 8L); return GithubProvider.Comparison.MATCH; });
        assertThatThrownBy(() -> service.reconcile(solution, 7, false)).isInstanceOf(CaptureValidationException.class);
        assertThat(job.getState()).isEqualTo(CommitJobState.UNKNOWN);
    }
    @Test void conflictsAndProviderFailuresPreserveUnknown() throws Exception {
        setup(GithubProvider.Diagnostic.TREE_UNCONFIRMED);
        when(provider.compare(current, solution)).thenReturn(GithubProvider.Comparison.CONFLICT).thenThrow(new IllegalStateException("secret provider body"));
        assertThat(service.reconcile(solution, 7, false).comparison()).isEqualTo("CONFLICT");
        assertThat(service.reconcile(solution, 7, false).comparison()).isEqualTo("UNAVAILABLE");
        assertThat(job.getState()).isEqualTo(CommitJobState.UNKNOWN);
    }
    private static void field(Object object, String name, Object value) throws Exception { Field field = object.getClass().getDeclaredField(name); field.setAccessible(true); field.set(object, value); }
}
