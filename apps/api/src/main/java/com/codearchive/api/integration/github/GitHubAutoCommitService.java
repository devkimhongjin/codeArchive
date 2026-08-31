package com.codearchive.api.integration.github;

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.stereotype.Service;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.exception.*;

@Service
public class GitHubAutoCommitService {
    private final GitHubAutoCommitStore store;
    private final GitHubCommitExecutor executor;
    private final GitHubIntegrationService integrations;
    private final GitHubAppClient github;
    private final GitHubPreviewSolutionReader sources;
    private final GitHubUploadPreviewService previews;
    public GitHubAutoCommitService(GitHubAutoCommitStore store,GitHubCommitExecutor executor,GitHubIntegrationService integrations,
            GitHubAppClient github,GitHubPreviewSolutionReader sources,GitHubUploadPreviewService previews) {
        this.store=store;this.executor=executor;this.integrations=integrations;this.github=github;this.sources=sources;this.previews=previews;
    }
    public Status enable(CodeArchivePrincipal p,UUID id,Enable request) {
        executor.gate();executor.activeOwner(p,false);
        if (request==null || request.target()==null) throw new CodeArchiveException(ErrorCode.INVALID_REQUEST);
        var target=request.target();
        if (!request.confirmAutomatic() || !request.acknowledgeVisibilityRisk() || (!target.privateRepository()&&!request.confirmPublicUpload()))
            throw new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_CONSENT_REQUIRED);
        GitHubBrowseInput.identifiers(target.installationId(),target.repositoryId());
        GitHubBrowseInput.reference(target.branch(),target.expectedCommitSha());
        String probe=path(target.folder(),"SWEA","1206","Java"); // Validate prefix plus the standard automatic layout.
        if (!store.start(p,id,target)) return status(p,id);
        try {
            var installation=integrations.requireInstallation(p,target.installationId());
            var inspected=github.inspectUploadTarget(target.installationId(),target.repositoryId(),installation.account().id(),target.branch(),target.expectedCommitSha(),probe);
            String fullName=inspected.repository().owner().login()+"/"+inspected.repository().name();
            if (inspected.protectedBranch() || inspected.obstruction()!=null || inspected.repository().privateRepository()!=target.privateRepository()
                    || !fullName.equals(target.fullName())) throw new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_TARGET_CHANGED);
            executor.activeOwner(p,false);executor.gate();store.activate(p,id);
            return status(p,id);
        } catch (RuntimeException failure) { store.stop(p,id); throw failure; }
    }
    public Status stop(CodeArchivePrincipal p,UUID id) {
        executor.activeOwner(p,false);store.stop(p,id);return status(p,id);
    }
    public Status status(CodeArchivePrincipal p,UUID id) {
        executor.activeOwner(p,false);
        if (id==null) id=store.current(p);
        if (id==null) return new Status(null,"OFF",null,null,null,null,null);
        var run=store.find(p,id,false);
        String state=run.state();
        if ((state.equals("ACTIVE")||state.equals("STARTING"))&&!run.leaseUntil().isAfter(Instant.now())) state="OFF";
        return new Status(id,state,run.target(),run.enabledAt(),run.leaseUntil(),run.errorCode(),store.last(id));
    }
    public Status tick(CodeArchivePrincipal p,UUID id) {
        executor.gate();executor.activeOwner(p,false);
        if (!executor.reserve()) throw new CodeArchiveException(ErrorCode.RATE_LIMITED);
        try {
            var claim=store.claim(p,id);
            if (claim==null) return status(p,id);
            var sent=new AtomicBoolean();
            try {
            var target=claim.run().target();
            var source=sources.find(p.userId(),claim.source()).orElseThrow(()->new CodeArchiveException(ErrorCode.GITHUB_PREVIEW_SOURCE_CHANGED));
            var selection=new GitHubUploadPreviewService.Request(source.id(),source.updatedAt(),target.installationId(),target.repositoryId(),target.branch(),
                    target.expectedCommitSha(),path(target.folder(),source.platform(),source.problemNumber(),source.language()),null);
            var preview=previews.preview(p,selection);
            if (!preview.blockers().isEmpty() || preview.target().privateRepository()!=target.privateRepository() || !preview.target().fullName().equals(target.fullName()))
                throw new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_TARGET_CHANGED);
            var resolved=new GitHubUploadPreviewService.Request(source.id(),source.updatedAt(),target.installationId(),target.repositoryId(),target.branch(),
                    target.expectedCommitSha(),preview.file().path(),preview.commitMessage());
            var review=new GitHubUploadIntentStore.Review(resolved,preview.file().sha256(),target.privateRepository(),target.fullName());
            var result=executor.execute(p,review,claim.run().leaseUntil(),()->store.requireLive(p,id,true,"ACTIVE"),sent);
            store.finish(claim,result,null,true);
            } catch(Exception failure) {
                ErrorCode code=sent.get()?ErrorCode.GITHUB_UPLOAD_OUTCOME_UNKNOWN:failure instanceof CodeArchiveException known?known.getErrorCode():ErrorCode.INTERNAL_ERROR;
                try { store.finish(claim,null,code,sent.get()); } catch(Exception ignored) { /* Durable ATTEMPTED blocks retries, including a new run. */ }
                throw new CodeArchiveException(code);
            }
            return status(p,id);
        } finally {
            executor.release();
        }
    }
    private static String path(String folder,String platform,String problem,String language) {
        if (folder==null) throw new CodeArchiveException(ErrorCode.INVALID_REQUEST);
        return GitHubUploadPath.choose((folder.isEmpty()?"":folder+"/")+GitHubUploadPath.choose(null,platform,problem,language),platform,problem,language);
    }
    public record Enable(GitHubAutoCommitStore.Target target,boolean confirmAutomatic,boolean acknowledgeVisibilityRisk,boolean confirmPublicUpload) {}
    public record Status(UUID runId,String state,GitHubAutoCommitStore.Target target,Instant enabledAt,Instant leaseUntil,String errorCode,GitHubAutoCommitStore.LastResult lastResult) {}
}
