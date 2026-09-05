package com.codearchive.api.automation;

import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.codearchive.api.integration.github.GitHubAppClient;
import com.codearchive.api.integration.github.GitHubAutoCommitStore;
import com.codearchive.api.integration.github.GitHubCommitExecutor;
import com.codearchive.api.integration.github.GitHubIntegrationService;
import com.codearchive.api.integration.github.GitHubPreviewSolutionReader;
import com.codearchive.api.integration.github.GitHubUploadIntentStore;
import com.codearchive.api.integration.github.GitHubUploadPath;

/** One bounded invocation; a future worker/scheduler may call runOnce(). */
@Service
public class DurableAutomationWorker {

    private final DurableWorkerStore store;
    private final GitHubIntegrationService integrations;
    private final GitHubAppClient github;
    private final GitHubCommitExecutor executor;
    private final GitHubPreviewSolutionReader sources;
    private final Clock clock;

    @Autowired
    public DurableAutomationWorker(DurableWorkerStore store, GitHubIntegrationService integrations,
            GitHubAppClient github, GitHubCommitExecutor executor, GitHubPreviewSolutionReader sources) {
        this(store, integrations, github, executor, sources, Clock.systemUTC());
    }

    DurableAutomationWorker(DurableWorkerStore store, GitHubIntegrationService integrations,
            GitHubAppClient github, GitHubCommitExecutor executor, GitHubPreviewSolutionReader sources, Clock clock) {
        this.store = store;
        this.integrations = integrations;
        this.github = github;
        this.executor = executor;
        this.sources = sources;
        this.clock = clock;
    }

    public Result runOnce() {
        Optional<DurableWorkerStore.Claim> claimed = store.claimNext();
        if (claimed.isEmpty()) return Result.idle();
        DurableWorkerStore.Claim claim = claimed.get();
        AtomicBoolean dispatched = new AtomicBoolean(false);
        try {
            store.requireLive(claim);
            var source = sources.find(claim.userId(), claim.solutionId())
                    .orElseThrow(() -> new CodeArchiveException(ErrorCode.GITHUB_PREVIEW_SOURCE_CHANGED));
            if (!source.acceptedCapture() || !"ACCEPTED".equals(source.result())) throw new CodeArchiveException(ErrorCode.GITHUB_PREVIEW_NOT_ELIGIBLE);
            var installation = integrations.requireInstallationForUser(claim.userId(), claim.target().installationId());
            var inspected = github.inspectUploadTarget(claim.target().installationId(), claim.target().repositoryId(),
                    installation.account().id(), claim.target().branch(), claim.target().expectedCommitSha(),
                    path(claim.target().folder(), source.platform(), source.problemNumber(), source.language()));
            String fullName = inspected.repository().owner().login() + "/" + inspected.repository().name();
            if (inspected.protectedBranch() || inspected.obstruction() != null
                    || inspected.repository().privateRepository() != claim.target().privateRepository()
                    || !fullName.equals(claim.target().fullName())) throw new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_TARGET_CHANGED);
            var selection = new com.codearchive.api.integration.github.GitHubUploadPreviewService.Request(
                    source.id(), source.updatedAt(), claim.target().installationId(), claim.target().repositoryId(),
                    claim.target().branch(), claim.target().expectedCommitSha(),
                    path(claim.target().folder(), source.platform(), source.problemNumber(), source.language()),
                    GitHubUploadPath.commitMessage(null, source.platform(), source.problemNumber()));
            var review = new GitHubUploadIntentStore.Review(selection,
                    GitHubUploadIntentStore.hash(source.code()), claim.target().privateRepository(), claim.target().fullName());
            // The uncertainty fence must commit before any provider mutation can start.
            store.markAttempted(claim);
            GitHubAppClient.CommitResult result = executor.executeForWorker(claim.userId(), review,
                    claim.leaseUntil(),
                    () -> store.requireLive(claim),
                    () -> {
                        // This is the final server-authoritative fence, after
                        // target inspection/preparation and immediately before
                        // provider mutation can begin.
                        store.requireLiveForDispatch(claim);
                        dispatched.set(true);
                    });
            if (result == null) {
                store.finish(claim, null, ErrorCode.GITHUB_UPLOAD_OUTCOME_UNKNOWN, true);
                return Result.unknown(claim.solutionId());
            }
            store.finish(claim, result, null, true);
            return Result.succeeded(claim.solutionId());
        } catch (RuntimeException failure) {
            ErrorCode error = failure instanceof CodeArchiveException known
                    ? known.getErrorCode() : ErrorCode.INTERNAL_ERROR;
            try { store.finish(claim, null, error, dispatched.get()); }
            catch (RuntimeException ignored) { /* An already terminal attempt remains fail-closed. */ }
            return dispatched.get() ? Result.unknown(claim.solutionId()) : Result.rejected(claim.solutionId(), error);
        }
    }

    private static String path(String folder, String platform, String problem, String language) {
        if (folder == null) throw new CodeArchiveException(ErrorCode.INVALID_REQUEST);
        return GitHubUploadPath.choose((folder.isEmpty() ? "" : folder + "/")
                + platform + "/" + problem + "/Solution." + GitHubUploadPath.extension(language), platform, problem, language);
    }

    public record Result(String status, UUID solutionId, String errorCode) {
        static Result idle() { return new Result("IDLE", null, null); }
        static Result succeeded(UUID id) { return new Result("SUCCEEDED", id, null); }
        static Result unknown(UUID id) { return new Result("UNKNOWN", id, ErrorCode.GITHUB_UPLOAD_OUTCOME_UNKNOWN.name()); }
        static Result rejected(UUID id, ErrorCode error) { return new Result("REJECTED", id, error.name()); }
    }
}
