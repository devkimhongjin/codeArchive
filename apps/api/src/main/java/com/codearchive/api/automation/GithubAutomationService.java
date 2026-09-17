package com.codearchive.api.automation;

import com.codearchive.api.auth.AppUser;
import com.codearchive.api.settings.UserSettings;
import com.codearchive.api.settings.UserSettingsRepository;
import com.codearchive.api.solution.Solution;
import com.codearchive.api.solution.SolutionRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Durable GitHub commit-job boundary; provider work happens only after capture persistence commits. */
@Service
public class GithubAutomationService {

    private final GithubCommitJobRepository jobs;
    private final UserSettingsRepository settings;
    private final SolutionRepository solutions;
    private final GithubProvider provider;
    private final GithubJobDispatcher dispatcher;
    private final TransactionTemplate transactions;
    private final Duration runningLease;

    @Autowired
    public GithubAutomationService(GithubCommitJobRepository jobs, UserSettingsRepository settings,
            SolutionRepository solutions, GithubProvider provider, GithubJobDispatcher dispatcher,
            PlatformTransactionManager manager,
            @Value("${codearchive.github.worker-running-lease-ms:300000}") long runningLeaseMs) {
        this.jobs = jobs;
        this.settings = settings;
        this.solutions = solutions;
        this.provider = provider;
        this.dispatcher = dispatcher;
        this.transactions = new TransactionTemplate(manager);
        this.runningLease = Duration.ofMillis(Math.max(1_000, runningLeaseMs));
    }

    /** Test-only compatibility constructor; production always receives its durable dispatcher. */
    public GithubAutomationService(GithubCommitJobRepository jobs, UserSettingsRepository settings,
            SolutionRepository solutions, GithubProvider provider) {
        this.jobs = jobs;
        this.settings = settings;
        this.solutions = solutions;
        this.provider = provider;
        this.dispatcher = GithubJobDispatcher.noop();
        this.transactions = null;
        this.runningLease = Duration.ofMinutes(5);
    }

    /**
     * The relay calls this within its capture transaction. The unique DB constraint stays
     * the idempotency boundary for concurrent relay deliveries.
     */
    @Transactional
    public void consider(AppUser user, Solution solution) {
        UserSettings current = settings.findByUserId(user.getId()).orElse(null);
        if (!eligible(current, solution)) {
            return;
        }
        GithubCommitJob job = jobs.findByUserIdAndCaptureId(user.getId(), solution.getCaptureId())
                .orElseGet(() -> jobs.save(new GithubCommitJob(user, solution.getCaptureId(), current.getVersion())));
        if (job != null) {
            scheduleDeliveryAfterCommit(job.getId());
        }
    }

    /** Polling-mode compatibility: stale leases are terminal and PENDING jobs are processed. */
    public void poll() {
        recoverStaleRunning();
        pendingJobIds().forEach(this::process);
    }

    /** Cloud worker recovery: stale leases become UNKNOWN and PENDING work is re-enqueued. */
    public void recoverAndDispatch() {
        recoverStaleRunning();
        pendingJobIds().forEach(this::dispatchCommittedJob);
    }

    public ProcessResult process(Long id) {
        Claim claim = inTransaction(() -> claim(id));
        if (claim == null) {
            return ProcessResult.IGNORED;
        }
        GithubProvider.Result outcome;
        try {
            outcome = provider.createOnly(claim.settings(), claim.solution(), () -> finalWriteAuthorized(claim));
        } catch (RuntimeException ignored) {
            // A provider exception after a durable claim is ambiguous, never retryable.
            outcome = GithubProvider.Result.unknown("Provider threw after durable claim");
        }
        GithubProvider.Result finalOutcome = outcome;
        return inTransaction(() -> complete(id, finalOutcome));
    }

    private ProcessResult complete(Long id, GithubProvider.Result outcome) {
        GithubCommitJob job = jobs.findById(id).orElse(null);
        if (job == null || job.getState() != CommitJobState.RUNNING) {
            return ProcessResult.IGNORED;
        }
        ProcessResult result = ProcessResult.COMPLETED;
        switch (outcome.outcome()) {
            case SUCCEEDED -> job.terminal(CommitJobState.SUCCEEDED);
            case UNKNOWN -> job.terminal(CommitJobState.UNKNOWN);
            case FAILED -> job.terminal(CommitJobState.FAILED);
            case RETRYABLE -> {
                if (job.getAttempts() >= 3) {
                    job.terminal(CommitJobState.FAILED);
                } else {
                    job.retry();
                    result = ProcessResult.RETRYABLE;
                }
            }
        }
        jobs.saveAndFlush(job);
        return result;
    }

    private void recoverStaleRunning() {
        Instant staleBefore = Instant.now().minus(runningLease);
        inTransaction(() -> {
            jobs.findTop25ByStateAndUpdatedAtBeforeOrderByCreatedAtAsc(CommitJobState.RUNNING, staleBefore)
                    .forEach(job -> {
                        job.terminal(CommitJobState.UNKNOWN);
                        jobs.saveAndFlush(job);
                    });
            return null;
        });
    }

    private List<Long> pendingJobIds() {
        return inTransaction(() -> jobs.findTop25ByStateOrderByCreatedAtAsc(CommitJobState.PENDING).stream()
                .map(GithubCommitJob::getId)
                .toList());
    }

    private Claim claim(Long id) {
        GithubCommitJob job = jobs.findByIdForClaim(id).orElse(null);
        if (job == null || job.getState() != CommitJobState.PENDING) {
            return null;
        }
        UserSettings current = settings.findByUserId(job.getUser().getId()).orElse(null);
        Solution solution = solutions.findByUserIdAndCaptureId(job.getUser().getId(), job.getCaptureId()).orElse(null);
        if (!eligibleForJob(current, solution, job)) {
            job.terminal(CommitJobState.FAILED);
            jobs.saveAndFlush(job);
            return null;
        }
        job.start();
        jobs.saveAndFlush(job);
        return new Claim(current, solution);
    }

    private boolean eligible(UserSettings current, Solution solution) {
        return current != null && current.isAutoSyncEnabled() && current.isGithubAutoCommitEnabled()
                && current.githubTargetConfigured() && current.getAutomationEnabledAt() != null
                && !solution.getObservedAt().isBefore(current.getAutomationEnabledAt());
    }

    private boolean eligibleForJob(UserSettings current, Solution solution, GithubCommitJob job) {
        return current != null && solution != null && current.isAutoSyncEnabled()
                && current.isGithubAutoCommitEnabled() && current.githubTargetConfigured()
                && current.getVersion() == job.getSettingsGeneration();
    }

    private boolean finalWriteAuthorized(Claim claim) {
        UserSettings current = settings.findByUserId(claim.settings().getUser().getId()).orElse(null);
        return current != null && current.getVersion() == claim.settings().getVersion()
                && current.isAutoSyncEnabled() && current.isGithubAutoCommitEnabled() && current.githubTargetConfigured();
    }

    private void scheduleDeliveryAfterCommit(Long jobId) {
        if (jobId == null) {
            return;
        }
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { dispatchCommittedJob(jobId); }
            });
        } else {
            dispatchCommittedJob(jobId);
        }
    }

    private void dispatchCommittedJob(Long jobId) {
        try {
            dispatcher.dispatch(jobId);
        } catch (RuntimeException exception) {
            // The capture and PENDING job are already durable. Recovery will retry delivery.
            org.slf4j.LoggerFactory.getLogger(GithubAutomationService.class)
                    .warn("GitHub job task dispatch failed after commit; job remains pending (jobId={})", jobId);
        }
    }

    private <T> T inTransaction(Supplier<T> work) {
        return transactions == null ? work.get() : transactions.execute(status -> work.get());
    }

    private record Claim(UserSettings settings, Solution solution) { }

    public enum ProcessResult { COMPLETED, RETRYABLE, IGNORED }
}
