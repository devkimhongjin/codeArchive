package com.codearchive.api.integration.github;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

@Service
public class GitHubUploadPreviewService {
    private final GitHubPreviewSolutionReader solutions;
    private final GitHubIntegrationService integrations;
    private final GitHubAppClient client;

    public GitHubUploadPreviewService(GitHubPreviewSolutionReader solutions,
            GitHubIntegrationService integrations, GitHubAppClient client) {
        this.solutions = solutions;
        this.integrations = integrations;
        this.client = client;
    }

    public Preview preview(CodeArchivePrincipal principal, Request request) {
        if (principal == null) throw new CodeArchiveException(ErrorCode.AUTH_REQUIRED);
        if (request == null || request.solutionId() == null || request.expectedUpdatedAt() == null) {
            throw new CodeArchiveException(ErrorCode.INVALID_REQUEST);
        }
        GitHubBrowseInput.identifiers(request.installationId(), request.repositoryId());
        GitHubBrowseInput.reference(request.branch(), request.expectedCommitSha());
        var source = solutions.find(principal.userId(), request.solutionId())
                .orElseThrow(() -> new CodeArchiveException(ErrorCode.SOLUTION_NOT_FOUND));
        if (!source.updatedAt().equals(request.expectedUpdatedAt())) throw changed();
        if (!source.acceptedCapture() || !"ACCEPTED".equals(source.result())) {
            throw new CodeArchiveException(ErrorCode.GITHUB_PREVIEW_NOT_ELIGIBLE);
        }
        String path = GitHubUploadPath.choose(request.path(), source.platform(), source.problemNumber(), source.language());
        String message = GitHubUploadPath.commitMessage(request.commitMessage(), source.platform(), source.problemNumber());
        byte[] content = source.code().getBytes(StandardCharsets.UTF_8);
        if (source.code().isBlank() || content.length > 1_048_576) {
            throw new CodeArchiveException(ErrorCode.GITHUB_PREVIEW_NOT_ELIGIBLE);
        }
        var installation = integrations.requireInstallation(principal, request.installationId());
        // The provider receives target selectors only, never the solution or commit message.
        var target = client.inspectUploadTarget(request.installationId(), request.repositoryId(),
                installation.account().id(), request.branch(), request.expectedCommitSha(), path);

        // Fresh JDBC read bypasses JPA's first-level cache; edits/deletion during network I/O invalidate the preview.
        var current = solutions.find(principal.userId(), request.solutionId()).orElseThrow(this::changed);
        if (!source.equals(current)) throw changed();

        var blockers = new ArrayList<String>();
        if (target.protectedBranch()) blockers.add("PROTECTED_BRANCH");
        if (target.obstruction() != null) blockers.add("PARENT_NOT_DIRECTORY");
        if (target.existingEntry() != null) blockers.add("PATH_EXISTS");
        var repository = target.repository();
        Target responseTarget = new Target(Long.toString(request.installationId()), Long.toString(repository.id()),
                repository.owner().login() + "/" + repository.name(), repository.privateRepository(),
                target.branch(), target.commitSha(), target.rootTreeSha(), target.protectedBranch(), path,
                target.missingDirectories(), target.existingEntry(), target.obstruction());
        // A creation diff is empty -> exact source bytes. Existing content is never fetched or overwritten.
        CreationDiff diff = blockers.isEmpty() ? new CreationDiff("ADD_FILE", "", source.code()) : null;
        return new Preview(blockers.isEmpty() ? "CREATE_PREVIEW" : "BLOCKED", true, false,
                new Source(source.id(), source.platform(), source.problemNumber(), source.language(), source.updatedAt()),
                responseTarget, new File(path, "UTF-8", content.length, digest(content)), message, diff,
                List.copyOf(blockers), repository.privateRepository()
                        ? "코드가 저장소 접근 권한을 가진 사람들에게 전달됩니다. 실제 업로드에는 별도 확인이 필요합니다."
                        : "공개 저장소에 업로드하면 누구나 코드를 볼 수 있습니다. 실제 업로드에는 별도 공개 확인이 필요합니다.");
    }

    private CodeArchiveException changed() {
        return new CodeArchiveException(ErrorCode.GITHUB_PREVIEW_SOURCE_CHANGED);
    }

    private static String digest(byte[] content) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content)); }
        catch (NoSuchAlgorithmException ignored) { throw new CodeArchiveException(ErrorCode.INTERNAL_ERROR); }
    }

    public record Request(UUID solutionId, Instant expectedUpdatedAt, long installationId, long repositoryId,
            String branch, String expectedCommitSha, String path, String commitMessage) {
        @Override public String toString() { return "UploadPreviewRequest[redacted]"; }
    }
    public record Source(UUID id, String platform, String problemNumber, String language, Instant updatedAt) {}
    public record Target(String installationId, String repositoryId, String fullName, boolean privateRepository,
            String branch, String commitSha, String rootTreeSha, boolean protectedBranch, String path,
            List<String> missingDirectories, GitHubAppClient.TreeEntry existingEntry, GitHubAppClient.TreeEntry obstruction) {}
    public record File(String path, String encoding, int byteLength, String sha256) {}
    public record CreationDiff(String operation, String before, String after) {
        @Override public String toString() { return "CreationDiff[redacted]"; }
    }
    public record Preview(String status, boolean readOnly, boolean uploadEnabled, Source source, Target target,
            File file, String commitMessage, CreationDiff diff, List<String> blockers, String disclosureNotice) {
        @Override public String toString() { return "UploadPreview[redacted]"; }
    }
}
