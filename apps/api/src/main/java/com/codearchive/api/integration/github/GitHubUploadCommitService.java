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
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

@Service
public class GitHubUploadCommitService {
    private final GitHubAppProperties properties;
    private final GitHubUploadPreviewService previews;
    private final GitHubIntegrationService integrations;
    private final GitHubAppClient github;
    private final GitHubUploadIntentStore intents;
    private final GitHubPreviewSolutionReader sources;
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final Semaphore slots = new Semaphore(2);

    public GitHubUploadCommitService(GitHubAppProperties properties, GitHubUploadPreviewService previews,
            GitHubIntegrationService integrations, GitHubAppClient github, GitHubUploadIntentStore intents,
            GitHubPreviewSolutionReader sources, JdbcTemplate db, PlatformTransactionManager transactions) {
        this.properties = properties; this.previews = previews; this.integrations = integrations; this.github = github;
        this.intents = intents; this.sources = sources; this.db = db;
        tx = new TransactionTemplate(transactions);
        tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        tx.setTimeout(20);
    }

    public Confirmation prepare(CodeArchivePrincipal principal, GitHubUploadPreviewService.Request request) {
        gate(); activeOwner(principal, false);
        var preview = previews.preview(principal, request);
        if (!preview.blockers().isEmpty()) throw new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_TARGET_CHANGED);
        var selection = new GitHubUploadPreviewService.Request(preview.source().id(), preview.source().updatedAt(),
                request.installationId(), request.repositoryId(), preview.target().branch(), preview.target().commitSha(),
                preview.file().path(), preview.commitMessage());
        activeOwner(principal, false);
        var intent = intents.create(principal, new GitHubUploadIntentStore.Review(selection, preview.file().sha256(),
                preview.target().privateRepository(), preview.target().fullName()));
        return new Confirmation(intent.id(), intent.expiresAt(), preview,
                "확인한 코드와 커밋 메시지를 GitHub에 전송합니다. 비공개 저장소도 전송 도중 또는 이후 공개로 바뀔 수 있으며, 전송한 코드는 자동으로 회수되지 않습니다.");
    }

    public Result status(CodeArchivePrincipal principal, UUID id) {
        activeOwner(principal, false);
        return result(intents.find(principal, id));
    }

    public Result commit(CodeArchivePrincipal principal, UUID id, Consent consent) {
        gate(); activeOwner(principal, false);
        var existing = intents.find(principal, id);
        if (consent == null || !consent.confirmUpload() || !consent.acknowledgeVisibilityRisk()
                || (!existing.review().privateRepository() && !consent.confirmPublicUpload())) {
            throw new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_CONSENT_REQUIRED);
        }
        if (!slots.tryAcquire()) throw new CodeArchiveException(ErrorCode.RATE_LIMITED);
        try {
            var claim = intents.claim(principal, id);
            if (!claim.acquired()) return result(claim.intent());
            var intent = claim.intent(); var review = intent.review(); var selection = review.selection();
            AtomicBoolean sent = new AtomicBoolean();
            try {
                var installation = integrations.requireInstallation(principal, selection.installationId());
                var prepared = github.prepareCommit(new GitHubAppClient.CommitSelection(selection.installationId(),
                        selection.repositoryId(), installation.account().id(), selection.branch(), selection.expectedCommitSha(),
                        selection.path(), review.privateRepository(), review.fullName()));
                var committed = tx.execute(transaction -> {
                    db.execute("SET LOCAL lock_timeout = '2s'");
                    long owner = activeOwner(principal, true);
                    if (owner != installation.account().id()) throw new CodeArchiveException(ErrorCode.ACCESS_DENIED);
                    var source = sources.findLocked(principal.userId(), selection.solutionId())
                            .orElseThrow(() -> new CodeArchiveException(ErrorCode.GITHUB_PREVIEW_SOURCE_CHANGED));
                    if (!intent.expiresAt().isAfter(Instant.now())) throw new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_INTENT_EXPIRED);
                    if (!source.acceptedCapture() || !"ACCEPTED".equals(source.result())
                            || !source.updatedAt().equals(selection.expectedUpdatedAt())
                            || !GitHubUploadIntentStore.hash(source.code()).equals(review.sourceSha256())) {
                        throw new CodeArchiveException(ErrorCode.GITHUB_PREVIEW_SOURCE_CHANGED);
                    }
                    gate();
                    // Only the single conditional mutation runs while source/session rows are share-locked.
                    // The durable claim has already committed; a crash/rollback can never restore READY.
                    sent.set(true);
                    return prepared.create(source.code(), selection.commitMessage());
                });
                intents.finish(id, "SUCCEEDED", committed, null);
                return result(intents.find(principal, id));
            } catch (Exception failure) {
                ErrorCode code = !sent.get() && failure instanceof CodeArchiveException known
                        ? known.getErrorCode() : sent.get() ? ErrorCode.GITHUB_UPLOAD_OUTCOME_UNKNOWN : ErrorCode.INTERNAL_ERROR;
                try { intents.finish(id, sent.get() ? "UNKNOWN" : "REJECTED", null, code); }
                catch (Exception ignored) { /* ATTEMPTED remains a durable no-retry tombstone if persistence fails. */ }
                throw new CodeArchiveException(code);
            }
        } finally { slots.release(); }
    }

    private long activeOwner(CodeArchivePrincipal principal, boolean lock) {
        if (principal == null) throw new CodeArchiveException(ErrorCode.AUTH_REQUIRED);
        return db.query("""
                SELECT u.github_user_id FROM auth_sessions s JOIN users u ON u.id=s.user_id
                WHERE s.id=? AND s.user_id=? AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()
                """ + (lock ? " FOR SHARE OF s,u" : ""), (row, index) -> row.getLong(1), principal.sessionId(), principal.userId())
                .stream().findFirst().orElseThrow(() -> new CodeArchiveException(ErrorCode.AUTH_REQUIRED));
    }

    private void gate() {
        if (!properties.isEnabled() || !properties.isContentsReadEnabled() || !properties.isContentsWriteEnabled()) {
            throw new CodeArchiveException(ErrorCode.GITHUB_INTEGRATION_UNAVAILABLE);
        }
    }

    private Result result(GitHubUploadIntentStore.Intent intent) {
        String state = intent.status().equals("ATTEMPTED") ? "UNKNOWN" : intent.status();
        return new Result(intent.id(), state, false, intent.commitSha(), intent.commitUrl(),
                state.equals("UNKNOWN") ? ErrorCode.GITHUB_UPLOAD_OUTCOME_UNKNOWN.name() : intent.errorCode());
    }
    public record Consent(boolean confirmUpload, boolean acknowledgeVisibilityRisk, boolean confirmPublicUpload) {}
    public record Confirmation(UUID intentId, Instant expiresAt, GitHubUploadPreviewService.Preview preview, String consentNotice) {
        @Override public String toString() { return "UploadConfirmation[redacted]"; }
    }
    public record Result(UUID intentId, String status, boolean retryAllowed, String commitSha, String commitUrl, String errorCode) {}
}
