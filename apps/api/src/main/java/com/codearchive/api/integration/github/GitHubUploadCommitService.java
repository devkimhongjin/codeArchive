package com.codearchive.api.integration.github;

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import org.springframework.stereotype.Service;

import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

@Service
public class GitHubUploadCommitService {
    private final GitHubUploadPreviewService previews;
    private final GitHubUploadIntentStore intents;
    private final GitHubCommitExecutor executor;

    public GitHubUploadCommitService(GitHubUploadPreviewService previews, GitHubUploadIntentStore intents, GitHubCommitExecutor executor) {
        this.previews=previews; this.intents=intents; this.executor=executor;
    }
    public Confirmation prepare(CodeArchivePrincipal principal, GitHubUploadPreviewService.Request request) {
        executor.gate(); executor.activeOwner(principal, false);
        var preview = previews.preview(principal, request);
        if (!preview.blockers().isEmpty()) throw new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_TARGET_CHANGED);
        var selection = new GitHubUploadPreviewService.Request(preview.source().id(), preview.source().updatedAt(),
                request.installationId(), request.repositoryId(), preview.target().branch(), preview.target().commitSha(),
                preview.file().path(), preview.commitMessage());
        executor.activeOwner(principal, false);
        var intent = intents.create(principal, new GitHubUploadIntentStore.Review(selection, preview.file().sha256(),
                preview.target().privateRepository(), preview.target().fullName()));
        return new Confirmation(intent.id(), intent.expiresAt(), preview,
                "확인한 코드와 커밋 메시지를 GitHub에 전송합니다. 비공개 저장소도 전송 도중 또는 이후 공개로 바뀔 수 있으며, 전송한 코드는 자동으로 회수되지 않습니다.");
    }

    public Result status(CodeArchivePrincipal principal, UUID id) {
        executor.activeOwner(principal, false);
        return result(intents.find(principal, id));
    }

    public Result commit(CodeArchivePrincipal principal, UUID id, Consent consent) {
        executor.gate(); executor.activeOwner(principal, false);
        var existing = intents.find(principal, id);
        if (consent == null || !consent.confirmUpload() || !consent.acknowledgeVisibilityRisk()
                || (!existing.review().privateRepository() && !consent.confirmPublicUpload())) {
            throw new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_CONSENT_REQUIRED);
        }

        if (!executor.reserve()) throw new CodeArchiveException(ErrorCode.RATE_LIMITED);
        try {
            var claim = intents.claim(principal, id);
            if (!claim.acquired()) return result(claim.intent());
            var intent = claim.intent(); var review = intent.review();
            AtomicBoolean sent = new AtomicBoolean();
            try {
                var committed = executor.execute(principal, review, intent.expiresAt(), () -> {}, sent);
                intents.finish(id, "SUCCEEDED", committed, null);
                return result(intents.find(principal, id));
            } catch (Exception failure) {
                ErrorCode code = !sent.get() && failure instanceof CodeArchiveException known
                        ? known.getErrorCode() : sent.get() ? ErrorCode.GITHUB_UPLOAD_OUTCOME_UNKNOWN : ErrorCode.INTERNAL_ERROR;
                try { intents.finish(id, sent.get() ? "UNKNOWN" : "REJECTED", null, code); }
                catch (Exception ignored) { /* ATTEMPTED remains a durable no-retry tombstone if persistence fails. */ }
                throw new CodeArchiveException(code);
            }
        } finally { executor.release(); }
    }

    private Result result(GitHubUploadIntentStore.Intent intent) {
        String state = intent.status().equals("ATTEMPTED") ? "UNKNOWN" : intent.status();
        if (state.equals("READY") && !intent.expiresAt().isAfter(Instant.now())) state = "EXPIRED";
        return new Result(intent.id(), state, false, intent.commitSha(), intent.commitUrl(),
                state.equals("UNKNOWN") ? ErrorCode.GITHUB_UPLOAD_OUTCOME_UNKNOWN.name()
                        : state.equals("EXPIRED") ? ErrorCode.GITHUB_UPLOAD_INTENT_EXPIRED.name() : intent.errorCode());
    }
    public record Consent(boolean confirmUpload, boolean acknowledgeVisibilityRisk, boolean confirmPublicUpload) {}
    public record Confirmation(UUID intentId, Instant expiresAt, GitHubUploadPreviewService.Preview preview, String consentNotice) {
        @Override public String toString() { return "UploadConfirmation[redacted]"; }
    }
    public record Result(UUID intentId, String status, boolean retryAllowed, String commitSha, String commitUrl, String errorCode) {}
}
