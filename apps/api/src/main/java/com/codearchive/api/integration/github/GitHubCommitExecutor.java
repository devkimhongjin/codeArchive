package com.codearchive.api.integration.github;

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.exception.*;

/** Shared conditional writer. Callers must durably claim their distinct authorization before entering. */
@Service
public class GitHubCommitExecutor {
    private final GitHubAppProperties properties;
    private final GitHubIntegrationService integrations;
    private final GitHubAppClient github;
    private final GitHubPreviewSolutionReader sources;
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final Semaphore slots = new Semaphore(2);

    public GitHubCommitExecutor(GitHubAppProperties properties, GitHubIntegrationService integrations,
            GitHubAppClient github, GitHubPreviewSolutionReader sources, JdbcTemplate db, PlatformTransactionManager transactions) {
        this.properties=properties; this.integrations=integrations; this.github=github; this.sources=sources; this.db=db;
        tx=new TransactionTemplate(transactions); tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW); tx.setTimeout(20);
    }

    GitHubAppClient.CommitResult execute(CodeArchivePrincipal principal, GitHubUploadIntentStore.Review review,
            Instant expiresAt, Runnable authorization, AtomicBoolean sent) {
        gate(); activeOwner(principal, false);
        var selection=review.selection();
        var installation=integrations.requireInstallation(principal, selection.installationId());
        var prepared=github.prepareCommit(new GitHubAppClient.CommitSelection(selection.installationId(), selection.repositoryId(),
                installation.account().id(), selection.branch(), selection.expectedCommitSha(), selection.path(), review.privateRepository(), review.fullName()));
        return tx.execute(transaction -> {
            db.execute("SET LOCAL lock_timeout = '2s'");
            authorization.run();
            if (activeOwner(principal, true)!=installation.account().id()) throw new CodeArchiveException(ErrorCode.ACCESS_DENIED);
            var source=sources.findLocked(principal.userId(), selection.solutionId())
                    .orElseThrow(() -> new CodeArchiveException(ErrorCode.GITHUB_PREVIEW_SOURCE_CHANGED));
            if (!expiresAt.isAfter(Instant.now())) throw new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_INTENT_EXPIRED);
            if (!source.acceptedCapture() || !"ACCEPTED".equals(source.result()) || !source.updatedAt().equals(selection.expectedUpdatedAt())
                    || !GitHubUploadIntentStore.hash(source.code()).equals(review.sourceSha256())) {
                throw new CodeArchiveException(ErrorCode.GITHUB_PREVIEW_SOURCE_CHANGED);
            }
            gate(); sent.set(true);
            return prepared.create(source.code(), selection.commitMessage());
        });
    }

    /** Same conditional writer for a durable worker; no Dashboard session is fabricated. */
    public GitHubAppClient.CommitResult executeForWorker(UUID userId, GitHubUploadIntentStore.Review review,
            Instant expiresAt, Runnable authorization, Runnable beforeDispatch) {
        gate();
        if (userId == null || review == null || expiresAt == null) throw new CodeArchiveException(ErrorCode.INVALID_REQUEST);
        var selection = review.selection();
        var installation = integrations.requireInstallationForUser(userId, selection.installationId());
        var prepared = github.prepareCommit(new GitHubAppClient.CommitSelection(selection.installationId(), selection.repositoryId(),
                installation.account().id(), selection.branch(), selection.expectedCommitSha(), selection.path(),
                review.privateRepository(), review.fullName()));
        return tx.execute(transaction -> {
            db.execute("SET LOCAL lock_timeout = '2s'");
            authorization.run();
            if (activeOwner(userId, true) != installation.account().id()) throw new CodeArchiveException(ErrorCode.ACCESS_DENIED);
            var source = sources.findLocked(userId, selection.solutionId())
                    .orElseThrow(() -> new CodeArchiveException(ErrorCode.GITHUB_PREVIEW_SOURCE_CHANGED));
            if (!expiresAt.isAfter(Instant.now())) throw new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_INTENT_EXPIRED);
            if (!source.acceptedCapture() || !"ACCEPTED".equals(source.result())
                    || !source.updatedAt().equals(selection.expectedUpdatedAt())
                    || !GitHubUploadIntentStore.hash(source.code()).equals(review.sourceSha256())) {
                throw new CodeArchiveException(ErrorCode.GITHUB_PREVIEW_SOURCE_CHANGED);
            }
            gate();
            beforeDispatch.run();
            return prepared.create(source.code(), selection.commitMessage());
        });
    }

    boolean reserve() { return slots.tryAcquire(); }
    void release() { slots.release(); }

    long activeOwner(CodeArchivePrincipal principal, boolean lock) {
        if (principal==null) throw new CodeArchiveException(ErrorCode.AUTH_REQUIRED);
        return db.query("""
                SELECT u.github_user_id FROM auth_sessions s JOIN users u ON u.id=s.user_id
                WHERE s.id=? AND s.user_id=? AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()
                """+(lock ? " FOR SHARE OF s,u" : ""), (row,index)->row.getLong(1), principal.sessionId(),principal.userId())
                .stream().findFirst().orElseThrow(()->new CodeArchiveException(ErrorCode.AUTH_REQUIRED));
    }

    long activeOwner(UUID userId, boolean lock) {
        if (userId == null) throw new CodeArchiveException(ErrorCode.AUTH_REQUIRED);
        return db.query("SELECT github_user_id FROM users WHERE id=?" + (lock ? " FOR SHARE" : ""),
                (row, index) -> row.getLong(1), userId).stream().findFirst()
                .orElseThrow(() -> new CodeArchiveException(ErrorCode.AUTH_REQUIRED));
    }

    void gate() {
        if (!properties.isEnabled() || !properties.isContentsReadEnabled() || !properties.isContentsWriteEnabled())
            throw new CodeArchiveException(ErrorCode.GITHUB_INTEGRATION_UNAVAILABLE);
    }
}
