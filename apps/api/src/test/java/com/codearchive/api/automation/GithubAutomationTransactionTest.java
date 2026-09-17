package com.codearchive.api.automation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.codearchive.api.auth.AppUser;
import com.codearchive.api.settings.SettingsRequest;
import com.codearchive.api.settings.UserSettings;
import com.codearchive.api.settings.UserSettingsRepository;
import com.codearchive.api.solution.Platform;
import com.codearchive.api.solution.Solution;
import com.codearchive.api.solution.SolutionRepository;
import java.lang.reflect.Field;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

class GithubAutomationTransactionTest {

    @Test
    void dispatchesOnlyAfterTheCaptureTransactionCommits() throws Exception {
        Fixture fixture = fixture();

        fixture.transaction.executeWithoutResult(status -> {
            fixture.service.consider(fixture.user, fixture.solution);
            verifyNoInteractions(fixture.dispatcher);
        });

        verify(fixture.dispatcher).dispatch(41L);
    }

    @Test
    void rollbackDoesNotDispatchTheNewPendingJob() throws Exception {
        Fixture fixture = fixture();

        fixture.transaction.executeWithoutResult(status -> {
            fixture.service.consider(fixture.user, fixture.solution);
            status.setRollbackOnly();
        });

        verifyNoInteractions(fixture.dispatcher);
        assertThat(fixture.job.getState()).isEqualTo(CommitJobState.PENDING);
    }

    @Test
    void postCommitDispatchFailureDoesNotChangeTheDurablePendingJobOrThrow() throws Exception {
        Fixture fixture = fixture();
        doThrow(new IllegalStateException("queue unavailable")).when(fixture.dispatcher).dispatch(41L);

        assertDoesNotThrow(() -> fixture.transaction.executeWithoutResult(
                status -> fixture.service.consider(fixture.user, fixture.solution)));

        verify(fixture.dispatcher).dispatch(41L);
        assertThat(fixture.job.getState()).isEqualTo(CommitJobState.PENDING);
    }

    @Test
    void recoveryRedispatchesPendingIdsButNeverRedispatchesStaleRunningJobs() throws Exception {
        Fixture fixture = fixture();
        GithubCommitJob stale = new GithubCommitJob(fixture.user, "stale", 1);
        stale.start();
        set(stale, "updatedAt", Instant.now().minusSeconds(600));
        GithubCommitJob pending = new GithubCommitJob(fixture.user, "pending", 1);
        set(pending, "id", 73L);
        when(fixture.jobs.findTop25ByStateAndUpdatedAtBeforeOrderByCreatedAtAsc(eq(CommitJobState.RUNNING), any()))
                .thenReturn(List.of(stale));
        when(fixture.jobs.findTop25ByStateOrderByCreatedAtAsc(CommitJobState.PENDING)).thenReturn(List.of(pending));

        fixture.service.recoverAndDispatch();

        assertThat(stale.getState()).isEqualTo(CommitJobState.UNKNOWN);
        verify(fixture.dispatcher).dispatch(73L);
        verify(fixture.dispatcher, never()).dispatch(fixture.job.getId());
    }

    private static Fixture fixture() throws Exception {
        GithubCommitJobRepository jobs = mock(GithubCommitJobRepository.class);
        UserSettingsRepository settings = mock(UserSettingsRepository.class);
        SolutionRepository solutions = mock(SolutionRepository.class);
        GithubProvider provider = mock(GithubProvider.class);
        GithubJobDispatcher dispatcher = mock(GithubJobDispatcher.class);
        AppUser user = AppUser.fromGithub("1", "owner", "Owner", null);
        set(user, "id", 1L);
        UserSettings configured = settings(user, 1, Instant.EPOCH);
        Solution solution = new Solution(user, "capture", Platform.SWEA, "1", "Title", "https://example.test",
                "Java", "class Main {}", "ACCEPTED", Instant.now(), Instant.now(), null, null);
        GithubCommitJob job = new GithubCommitJob(user, "capture", 1);
        set(job, "id", 41L);
        when(settings.findByUserId(1L)).thenReturn(Optional.of(configured));
        when(jobs.findByUserIdAndCaptureId(1L, "capture")).thenReturn(Optional.empty());
        when(jobs.save(any(GithubCommitJob.class))).thenReturn(job);

        DataSourceTransactionManager manager = new DataSourceTransactionManager(
                new DriverManagerDataSource("jdbc:h2:mem:github-automation-transaction;DB_CLOSE_DELAY=-1", "sa", ""));
        return new Fixture(jobs, dispatcher, user, solution, job, new TransactionTemplate(manager),
                new GithubAutomationService(jobs, settings, solutions, provider, dispatcher, manager, 300_000));
    }

    private static UserSettings settings(AppUser user, long version, Instant boundary) throws Exception {
        UserSettings settings = new UserSettings(user);
        settings.apply(new SettingsRequest(0, "n", "n", false, false, "{number}", "{number}", "Add {platform} {number} solution",
                "github-light", "github-dark", true, true, 1L, "owner", "repo", "main", null));
        set(settings, "version", version);
        set(settings, "automationEnabledAt", boundary);
        return settings;
    }

    private static void set(Object target, String name, Object value) throws Exception {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    private record Fixture(GithubCommitJobRepository jobs, GithubJobDispatcher dispatcher, AppUser user,
            Solution solution, GithubCommitJob job, TransactionTemplate transaction, GithubAutomationService service) {
    }
}
